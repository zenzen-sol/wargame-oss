// Paragraph rewriter.
//
// Given a flattened paragraph + a (deleteStart, deleteEnd, insertedText)
// triple, produce a new array of paragraph children that expresses the
// change as native Word tracked changes:
//
//   • Children entirely before deleteStart are passed through.
//   • Children entirely after deleteEnd are passed through (after we
//     emit the del/ins block).
//   • Children that overlap the edit are unwrapped — their kept-text
//     portions are re-emitted as bare `<w:r>` with the original
//     `<w:rPr>` cloned, and the deleted segment lands inside a single
//     `<w:del>` while the inserted text lands inside a single `<w:ins>`.
//
// Unwrapping affected `<w:ins>` wrappers matches the "accepted view"
// rule: if a new edit touches text inside a previously-inserted run,
// we collapse that prior insertion as if accepted before applying the
// new change.

import type { Flattened } from "./flatten";
import {
  cloneNode,
  elChildren,
  elName,
  makeEl,
  makeText,
  setChildren,
  type XNode,
} from "./xml";

/** Word's tracked-change conventions use author-keyed colors by
 *  default, which means a deletion authored by Wargame ends up in
 *  whatever palette colour Word picks. We override per-run via
 *  `<w:color>` so the redline reads the same regardless of how a
 *  reviewer opens it: red for deletions, blue for insertions. */
const DELETE_COLOR_HEX = "FF0000";
const INSERT_COLOR_HEX = "0000FF";

/** Return an `<w:rPr>` that carries `color`, cloning the template
 *  (when provided) so existing formatting (bold, italic, etc.) sticks.
 *  Any pre-existing `<w:color>` child is replaced.
 *
 *  We also strip `<w:rStyle>` references and any inline `<w:u>` from
 *  the clone. The source `.docx` often carries leftover character
 *  styles from prior tracked-change tools (DeltaView / Workshare),
 *  e.g. `DeltaViewInsertion` whose rPr sets `<w:u val="double"/>`.
 *  When our `<w:ins>` wrapper inherits that, the inserted text
 *  renders with a DOUBLE underline on top of our explicit
 *  `<w:u val="none"/>` override — the browser reserves vertical
 *  space for the second underline, which presents as a "looser
 *  line-height" only inside the inserted block. The `<w:ins>` and
 *  `<w:del>` wrappers carry the change semantics on their own; we
 *  don't need any sibling tool's style baked in.
 *
 *  We also drop run-level `<w:u>` because Word's tracked-change
 *  convention is for the `<w:ins>` wrapper itself to render the
 *  underline; an explicit `<w:u>` on the run would either duplicate
 *  it or compete with the wrapper. */
function rPrWithColor(rPr: XNode | null, colorHex: string): XNode {
  const out = rPr ? cloneNode(rPr) : makeEl("w:rPr");
  const kept = elChildren(out).filter((c) => {
    const name = elName(c);
    return name !== "w:color" && name !== "w:rStyle" && name !== "w:u";
  });
  kept.push(makeEl("w:color", [], { "w:val": colorHex }));
  setChildren(out, kept);
  return out;
}

export interface RewriteOptions {
  paraChildren: XNode[];
  flat: Flattened;
  deleteStart: number;
  deleteEnd: number;
  insertedText: string;
  /** OOXML `w:id` for the emitted `<w:del>` wrapper (when deletedText
   *  is non-empty). Caller is responsible for monotonicity. */
  delWId?: string;
  /** OOXML `w:id` for the emitted `<w:ins>` wrapper (when insertedText
   *  is non-empty). */
  insWId?: string;
  author: string;
  date: string;
}

export function rewriteParagraph(opts: RewriteOptions): XNode[] {
  const { paraChildren, flat, deleteStart, deleteEnd, insertedText } = opts;

  // For each top-level child: the (start, end) char range it covers in
  // paraText (over its run slots' text nodes). A child without text
  // content (bookmark markers, paragraph properties, etc.) has
  // `hasText:false` and gets passed through.
  type ChildRange = { start: number; end: number; hasText: boolean };
  const childRanges = new Map<number, ChildRange>();
  for (const slot of flat.runs) {
    let curr = childRanges.get(slot.childIndex);
    if (!curr) {
      curr = { start: Number.POSITIVE_INFINITY, end: -1, hasText: false };
      childRanges.set(slot.childIndex, curr);
    }
    for (const tn of slot.textNodes) {
      if (tn.paraEnd > tn.paraStart) {
        curr.hasText = true;
        if (tn.paraStart < curr.start) curr.start = tn.paraStart;
        if (tn.paraEnd > curr.end) curr.end = tn.paraEnd;
      }
    }
  }

  // Template `<w:rPr>` for the del/ins block: borrow from the first
  // affected slot so the strike-through and underline inherit the
  // local formatting (bold, italic, etc.).
  let rPrTemplate: XNode | null = null;
  for (const slot of flat.runs) {
    let touched = false;
    for (const tn of slot.textNodes) {
      if (tn.paraEnd > deleteStart && tn.paraStart < deleteEnd) {
        touched = true;
        break;
      }
    }
    if (touched) {
      rPrTemplate = slot.rPr;
      break;
    }
  }

  const output: XNode[] = [];
  let delInsEmitted = false;

  const emitDelIns = () => {
    if (delInsEmitted) return;
    const deletedText = flat.paraText.slice(deleteStart, deleteEnd);
    if (deletedText.length > 0) {
      output.push(
        makeEl(
          "w:del",
          [
            buildRun(
              rPrWithColor(rPrTemplate, DELETE_COLOR_HEX),
              deletedText,
              "w:delText",
            ),
          ],
          {
            "w:id": opts.delWId ?? "0",
            "w:author": opts.author,
            "w:date": opts.date,
          },
        ),
      );
    }
    if (insertedText.length > 0) {
      output.push(
        makeEl(
          "w:ins",
          [
            buildRun(
              rPrWithColor(rPrTemplate, INSERT_COLOR_HEX),
              insertedText,
              "w:t",
            ),
          ],
          {
            "w:id": opts.insWId ?? "0",
            "w:author": opts.author,
            "w:date": opts.date,
          },
        ),
      );
    }
    delInsEmitted = true;
  };

  const emitRange = (rangeStart: number, rangeEnd: number) => {
    if (rangeStart >= rangeEnd) return;
    let i = rangeStart;
    while (i < rangeEnd) {
      const runIdx = flat.charRun[i];
      if (runIdx === undefined) {
        i++;
        continue;
      }
      const slot = flat.runs[runIdx];
      if (!slot) {
        i++;
        continue;
      }
      const rPr = slot.rPr;
      let j = i + 1;
      while (j < rangeEnd && flat.charRun[j] === runIdx) j++;
      output.push(buildRun(rPr, flat.paraText.slice(i, j), "w:t"));
      i = j;
    }
  };

  for (let ci = 0; ci < paraChildren.length; ci++) {
    const child = paraChildren[ci];
    if (!child) continue;
    const range = childRanges.get(ci);

    if (!range || !range.hasText) {
      // No text — pass through. Make sure ordering vs del/ins stays
      // correct: anything sitting after the edit position must come
      // after del/ins.
      output.push(child);
      continue;
    }

    if (range.end <= deleteStart) {
      output.push(child);
      continue;
    }
    if (range.start >= deleteEnd) {
      if (!delInsEmitted) emitDelIns();
      output.push(child);
      continue;
    }

    // Overlaps the edit. Drop the wrapper (incl. w:ins) and emit bare
    // runs for the surviving text on either side.
    emitRange(range.start, Math.min(range.end, deleteStart));
    if (!delInsEmitted) emitDelIns();
    emitRange(Math.max(range.start, deleteEnd), range.end);
  }

  // Pure insertion at end-of-paragraph (or any case where no child
  // straddled deleteStart) — emit the inserted block as the last entry.
  if (!delInsEmitted) emitDelIns();

  return output;
}

/** Build a `<w:r>` element wrapping `text` in the given tag (`w:t` for
 *  inserts/kept text, `w:delText` for deletions). Clones the provided
 *  `<w:rPr>` for style continuity. */
function buildRun(
  rPr: XNode | null,
  text: string,
  tagName: "w:t" | "w:delText",
): XNode {
  const children: XNode[] = [];
  if (rPr) children.push(cloneNode(rPr));
  children.push(
    makeEl(tagName, [makeText(text)], { "xml:space": "preserve" }),
  );
  return makeEl("w:r", children);
}
