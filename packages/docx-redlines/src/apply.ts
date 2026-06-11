// Orchestrator — the public `applyTrackedEdits` entrypoint.
//
// Phase 1 strategy: parse the document once, locate every edit
// against the original (unmodified) paragraphs, then apply mutations
// right-to-left within each paragraph so earlier offsets stay valid.
// Edits across different paragraphs are independent and can be
// applied in any order.

import JSZip from "jszip";
import { flattenParagraph } from "./flatten";
import {
  type AnchorResult,
  locateAnchor,
  normaliseWs,
} from "./match";
import { rewriteParagraph } from "./emit";
import type {
  AppliedChange,
  ApplyTrackedEditsOptions,
  ApplyTrackedEditsResult,
  EditError,
} from "./types";
import {
  type XNode,
  elAttrs,
  elChildren,
  elName,
  parseDocument,
  serializeDocument,
  setChildren,
  walkElements,
} from "./xml";
import { getZipEntry, setZipEntry } from "./zip";

const DOCUMENT_PATH = "word/document.xml";

export async function applyTrackedEdits(
  options: ApplyTrackedEditsOptions,
): Promise<ApplyTrackedEditsResult> {
  const zip = await JSZip.loadAsync(options.bytes);
  const entry = getZipEntry(zip, DOCUMENT_PATH);
  if (!entry) {
    throw new Error(
      `docx-redlines: missing ${DOCUMENT_PATH} in archive — not a valid .docx?`,
    );
  }

  const xml = await entry.async("string");
  const tree = parseDocument(xml);
  const date = options.date ?? new Date().toISOString();

  // Collect every `<w:p>` element in the body and flatten its current
  // children. Paragraphs are mutable nodes — when we later rewrite
  // one, we replace its children array in place.
  const paragraphs = collectParagraphs(tree);
  const paragraphData = paragraphs.map((p) => {
    const flat = flattenParagraph(elChildren(p));
    return { flat, norm: normaliseWs(flat.paraText) };
  });
  const paragraphFlats = paragraphData.map((d) => d.flat);
  const paragraphNorms = paragraphData.map((d) => d.norm);
  const paragraphTexts = paragraphData.map((d) => ({
    text: d.flat.paraText,
    norm: d.norm,
  }));

  // Plan every edit before mutating anything so each edit's anchors
  // are evaluated against the original (unmodified) text.
  interface Plan {
    editIndex: number;
    paraIdx: number;
    deleteStart: number;
    deleteEnd: number;
    insertedText: string;
    contextBefore: string;
    contextAfter: string;
    reason?: string;
  }
  const plans: Plan[] = [];
  const errors: EditError[] = [];
  const redundant: EditError[] = [];

  for (let i = 0; i < options.edits.length; i++) {
    const edit = options.edits[i];
    if (!edit) continue;
    const findNorm = normaliseWs(edit.find).norm;
    const ctxBeforeNorm = normaliseWs(edit.contextBefore).norm;
    const ctxAfterNorm = normaliseWs(edit.contextAfter).norm;

    if (edit.find.length === 0 && edit.replace.length === 0) {
      errors.push({ index: i, reason: "Empty edit (find and replace both empty)." });
      continue;
    }
    if (edit.find.length === 0 && !edit.contextBefore && !edit.contextAfter) {
      errors.push({
        index: i,
        reason: "Pure insertion requires contextBefore or contextAfter.",
      });
      continue;
    }

    const result: AnchorResult = locateAnchor(
      paragraphTexts,
      findNorm,
      ctxBeforeNorm,
      ctxAfterNorm,
    );

    if (result.kind === "ambiguous") {
      errors.push({
        index: i,
        reason: `Ambiguous match for find="${truncate(edit.find, 80)}". Add longer contextBefore / contextAfter so the anchor is unique.`,
      });
      continue;
    }
    if (result.kind === "not-found") {
      errors.push({
        index: i,
        reason: `Could not locate find="${truncate(edit.find, 80)}" in the document. Re-read the document and copy text verbatim, including punctuation.`,
      });
      continue;
    }

    plans.push({
      editIndex: i,
      paraIdx: result.paraIdx,
      deleteStart: result.origStart,
      deleteEnd: result.origEnd,
      insertedText: edit.replace,
      contextBefore: edit.contextBefore,
      contextAfter: edit.contextAfter,
      reason: edit.reason,
    });
  }

  // Detect within-paragraph overlapping edits. After grouping by
  // paragraph and sorting by deleteStart, any adjacent pair where
  // a.deleteEnd > b.deleteStart overlaps.
  const plansByParaIdx = new Map<number, Plan[]>();
  for (const plan of plans) {
    const list = plansByParaIdx.get(plan.paraIdx) ?? [];
    list.push(plan);
    plansByParaIdx.set(plan.paraIdx, list);
  }
  const accepted: Plan[] = [];
  for (const [, list] of plansByParaIdx) {
    list.sort((a, b) => a.deleteStart - b.deleteStart);
    let prevStart = -1;
    let prevEnd = -1;
    for (const plan of list) {
      if (plan.deleteStart < prevEnd) {
        // Two overlap flavors:
        // - "redundant": this plan's deletion range is fully contained
        //   within the earlier plan's range (e.g. "Maintenance Period"
        //   inside "Maintenance Periods"). The earlier edit already
        //   covers the same content; no coverage loss, just noise.
        // - "errored": partial overlap that would corrupt the document
        //   if applied. The caller should know an edit was dropped.
        const contained =
          plan.deleteStart >= prevStart && plan.deleteEnd <= prevEnd;
        if (contained) {
          redundant.push({
            index: plan.editIndex,
            reason:
              "Edit's range is fully contained within an earlier edit in the same paragraph — the earlier edit already covered this content. No coverage loss.",
          });
        } else {
          errors.push({
            index: plan.editIndex,
            reason:
              "Edit overlaps an earlier edit in the same paragraph. Issue these as a single batch only when their ranges don't overlap.",
          });
        }
        continue;
      }
      prevStart = plan.deleteStart;
      prevEnd = plan.deleteEnd;
      accepted.push(plan);
    }
  }

  // Apply accepted plans right-to-left within each paragraph so
  // offsets earlier in the same paragraph stay valid.
  let nextWId = maxTrackedId(tree) + 1;
  const changes: AppliedChange[] = [];
  const acceptedByParaIdx = new Map<number, Plan[]>();
  for (const plan of accepted) {
    const list = acceptedByParaIdx.get(plan.paraIdx) ?? [];
    list.push(plan);
    acceptedByParaIdx.set(plan.paraIdx, list);
  }
  for (const [paraIdx, list] of acceptedByParaIdx) {
    list.sort((a, b) => b.deleteStart - a.deleteStart);
    const para = paragraphs[paraIdx];
    let flat = paragraphFlats[paraIdx];
    if (!para || !flat) continue;
    for (const plan of list) {
      const deletedText = flat.paraText.slice(plan.deleteStart, plan.deleteEnd);
      const delWId = deletedText.length > 0 ? String(nextWId++) : undefined;
      const insWId = plan.insertedText.length > 0 ? String(nextWId++) : undefined;
      const newChildren = rewriteParagraph({
        paraChildren: elChildren(para),
        flat,
        deleteStart: plan.deleteStart,
        deleteEnd: plan.deleteEnd,
        insertedText: plan.insertedText,
        delWId,
        insWId,
        author: options.author,
        date,
      });
      setChildren(para, newChildren);
      // Re-flatten the paragraph for any subsequent edits in this
      // batch. (With right-to-left ordering this isn't strictly
      // required for offset validity, but it keeps the abstraction
      // consistent and is cheap.)
      flat = flattenParagraph(newChildren);
      changes.push({
        id: `${plan.editIndex}`,
        delWId,
        insWId,
        deletedText,
        insertedText: plan.insertedText,
        contextBefore: plan.contextBefore,
        contextAfter: plan.contextAfter,
        reason: plan.reason,
      });
    }
  }

  const serialised = serializeDocument(tree);
  setZipEntry(zip, DOCUMENT_PATH, serialised);
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return { bytes, changes, errors, redundant };
}

function collectParagraphs(tree: ReturnType<typeof parseDocument>): XNode[] {
  const out: XNode[] = [];
  for (const node of walkElements(tree)) {
    if (elName(node) === "w:p") out.push(node);
  }
  return out;
}

function maxTrackedId(tree: ReturnType<typeof parseDocument>): number {
  let max = 0;
  for (const node of walkElements(tree)) {
    const name = elName(node);
    if (name !== "w:ins" && name !== "w:del") continue;
    const raw = elAttrs(node)["@_w:id"];
    if (typeof raw !== "string") continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
