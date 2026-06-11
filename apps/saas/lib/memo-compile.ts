// Plan 09 — compile the memo agent's structured output into a
// downloadable `.docx` and persist it to Storage.
//
// The memo lives at a project-scoped Storage key alongside the
// redline (same owner prefix so Storage RLS policy applies
// unchanged). One memo per run.

import "server-only";
import { uploadObject } from "@/lib/storage";
import type {
  MemoAgreedEntry,
  MemoDocument,
  MemoNotYetDiscussedEntry,
  MemoOpenEntry,
} from "@wargame-esq/agents";
import { formatPartiesForMemo } from "@wargame-esq/agents";
import {
  AlignmentType,
  Document,
  Footer,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

export interface MemoCompileInput {
  projectId: string;
  ownerId: string;
  contractTitle: string;
  memo: MemoDocument;
  /** Completion date — ISO string. The compile step formats it. */
  completedAtIso: string;
  /** Parties on each side. Surfaced in the cover block so the reader
   *  can identify Blue and Red without cross-referencing the project. */
  blueParties: { name: string; role: string }[];
  redParties: { name: string; role: string }[];
}

export interface MemoCompileResult {
  storageKey: string;
  downloadFilename: string;
  agreedCount: number;
  openCount: number;
  notYetDiscussedCount: number;
}

const FONT = "Calibri";
const BODY_SIZE = 22; // 11pt in half-points — used for everything
const SMALL_SIZE = 18; // 9pt — privileged-and-confidential header + footer

export async function compileMemo(
  input: MemoCompileInput,
): Promise<MemoCompileResult> {
  const {
    projectId,
    ownerId,
    contractTitle,
    memo,
    completedAtIso,
    blueParties,
    redParties,
  } = input;

  const dateLabel = formatDate(completedAtIso);
  const blueLabel = formatPartiesForMemo(blueParties);
  const redLabel = formatPartiesForMemo(redParties);

  const children: Paragraph[] = [];

  // Privileged-and-confidential header (9pt, bold).
  children.push(privilegedHeader());
  children.push(blank());

  // Cover block. PARTIES disambiguates who Blue and Red are so the
  // reader doesn't have to cross-reference the project page.
  children.push(coverLine("RE:", `${contractTitle} — Negotiation handoff`));
  children.push(coverLine("DATE:", dateLabel));
  children.push(coverLine("BLUE:", blueLabel));
  children.push(coverLine("RED:", redLabel));
  children.push(blank());

  // Summary
  children.push(heading("SUMMARY"));
  for (const para of paragraphsFromText(memo.summary)) {
    children.push(body(para));
  }
  children.push(blank());

  // Agreed changes
  children.push(heading("AGREED CHANGES"));
  if (memo.agreed.length === 0) {
    children.push(body("(None.)"));
  } else {
    memo.agreed.forEach((a, i) => {
      children.push(...renderAgreed(a, i + 1));
    });
  }

  // Open issues
  children.push(heading("OPEN ISSUES"));
  if (memo.openIssues.length === 0) {
    children.push(body("(None.)"));
  } else {
    memo.openIssues.forEach((o, i) => {
      children.push(...renderOpen(o, i + 1));
    });
  }

  // Not yet discussed
  children.push(heading("NOT YET DISCUSSED"));
  if (memo.notYetDiscussed.length === 0) {
    children.push(body("(None.)"));
  } else {
    memo.notYetDiscussed.forEach((d, i) => {
      children.push(...renderNotYetDiscussed(d, i + 1));
    });
  }

  const doc = new Document({
    creator: "Wargame ESQ — Neutral counsel",
    title: `${contractTitle} — Negotiation handoff memo`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE },
        },
      },
    },
    sections: [
      {
        properties: {},
        footers: { default: pageFooter() },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const storageKey = `${ownerId}/${projectId}/memo-${cryptoUUID()}.docx`;
  const downloadFilename = `${sanitizeFilename(contractTitle)}.memo.docx`;
  await uploadObject(
    storageKey,
    new Uint8Array(buffer),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  return {
    storageKey,
    downloadFilename,
    agreedCount: memo.agreed.length,
    openCount: memo.openIssues.length,
    notYetDiscussedCount: memo.notYetDiscussed.length,
  };
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderAgreed(a: MemoAgreedEntry, n: number): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(issueTitle(`${n}. ${a.issueTitle}`));
  out.push(body(a.summary));
  out.push(...renderQuestions(a.questions));
  out.push(blank());
  return out;
}

function renderOpen(o: MemoOpenEntry, n: number): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(issueTitle(`${n}. ${o.issueTitle}`));
  out.push(body(o.gap));
  out.push(labelled("Blue's last position:", o.bluePosition));
  out.push(labelled("Red's last position:", o.redPosition));
  out.push(labelled("Recommendation:", o.recommendation));
  out.push(...renderQuestions(o.questions));
  out.push(blank());
  return out;
}

function renderNotYetDiscussed(
  d: MemoNotYetDiscussedEntry,
  n: number,
): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(issueTitle(`${n}. ${d.issueTitle}`));
  out.push(body(d.summary));
  out.push(...renderQuestions(d.questions));
  out.push(blank());
  return out;
}

function renderQuestions(questions: string[] | undefined): Paragraph[] {
  if (!questions || questions.length === 0) return [];
  const out: Paragraph[] = [questionsLabel()];
  for (const q of questions) {
    out.push(questionBullet(q));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paragraph helpers
// ---------------------------------------------------------------------------

function privilegedHeader(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 276 },
    children: [
      new TextRun({
        text: "PRIVILEGED & CONFIDENTIAL",
        bold: true,
        size: SMALL_SIZE,
        font: FONT,
      }),
    ],
  });
}

function coverLine(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 60, line: 276 },
    children: [
      new TextRun({
        text: label.padEnd(10, " "),
        bold: true,
        size: BODY_SIZE,
        font: FONT,
      }),
      new TextRun({ text: value, size: BODY_SIZE, font: FONT }),
    ],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    // Don't use the built-in HEADING_1 style — it ships with a blue
    // colour by default. We want plain black bold text at body size.
    spacing: { before: 240, after: 120, line: 276 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: BODY_SIZE,
        font: FONT,
        color: "000000",
      }),
    ],
  });
}

function issueTitle(text: string): Paragraph {
  const trimmed = text.trimEnd();
  const punctuated = /[.!?:;]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return new Paragraph({
    spacing: { before: 120, after: 60, line: 276 },
    children: [
      new TextRun({
        text: punctuated,
        bold: true,
        size: BODY_SIZE,
        font: FONT,
      }),
    ],
  });
}

function body(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 80, line: 276 },
    children: [new TextRun({ text, size: BODY_SIZE, font: FONT })],
  });
}

function labelled(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 60, line: 276 },
    children: [
      new TextRun({
        text: `${label} `,
        italics: true,
        size: BODY_SIZE,
        font: FONT,
      }),
      new TextRun({ text: value, size: BODY_SIZE, font: FONT }),
    ],
  });
}

function questionsLabel(): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 40, line: 276 },
    children: [
      new TextRun({
        text: "Questions for the deal team:",
        italics: true,
        size: BODY_SIZE,
        font: FONT,
      }),
    ],
  });
}

function questionBullet(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 40, line: 276 },
    indent: { left: 360, hanging: 240 },
    children: [
      new TextRun({ text: "• ", size: BODY_SIZE, font: FONT }),
      new TextRun({ text, size: BODY_SIZE, font: FONT }),
    ],
  });
}

function blank(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 276 },
    children: [new TextRun({ text: "", size: BODY_SIZE, font: FONT })],
  });
}

function pageFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
            size: SMALL_SIZE,
            font: FONT,
          }),
        ],
      }),
    ],
  });
}

function paragraphsFromText(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function sanitizeFilename(name: string): string {
  const stripped = name.replace(/\.docx$/i, "").replace(/[^a-zA-Z0-9_.\- ]/g, "_");
  return stripped.length > 0 ? stripped : "contract";
}

function cryptoUUID(): string {
  return crypto.randomUUID();
}
