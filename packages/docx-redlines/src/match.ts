// Whitespace + punctuation-normalised anchor matching.
//
// Models drift on whitespace — a model that quotes "Section 9.1" might
// actually emit "Section  9.1" or "Section\n9.1". The matcher collapses
// runs of whitespace to a single space before searching, and keeps a
// mapping from normalised offsets back to original offsets so callers
// can splice the OOXML at the right place.
//
// Models also drift on punctuation. Word docs default to "smart"
// curly quotes (U+2018/U+2019/U+201C/U+201D), em/en dashes
// (U+2014/U+2013), and non-breaking spaces (U+00A0). LLMs reading
// the markdown reproduction of the doc emit ASCII straight quotes
// and hyphens. Without folding, a single curly-vs-straight
// apostrophe in "Dechert's" mismatches the whole 70-word `find`
// and the redline compiles to 0-applied. (Observed 2026-05-17 on
// every Anthropic run; never on OpenAI runs because GPT happened
// to mirror smart quotes more often. The matcher should not depend
// on either model's punctuation reproduction.)
//
// Folding is character-for-character so the `normToOrig`/
// `origToNorm` position maps stay 1:1 with the source. NBSP folds
// into the whitespace-collapse path so it joins runs.
//
// Strategy is a three-stage fallback per edit:
//   1. `find` + full `contextBefore` + `contextAfter`
//   2. `find` + only whichever side of context is provided
//   3. `find` alone (must be globally unique across the document)
//
// At each stage we scan every paragraph. A stage succeeds only if
// exactly one paragraph yields exactly one match; otherwise we either
// retry the next stage or surface an ambiguity error.

export interface Normalised {
  /** Normalised string: runs of whitespace collapsed to single space,
   *  leading/trailing whitespace preserved as a single space if any. */
  norm: string;
  /** For each char in `norm`: the corresponding offset in the
   *  original string (start of the whitespace run that collapsed to
   *  this position, or the char position for non-whitespace chars). */
  normToOrig: Int32Array;
  /** `origToNorm[i]` is the offset in `norm` where the original char
   *  at offset `i` landed. For collapsed whitespace, every char in the
   *  run maps to the same `norm` offset. Length is `orig.length + 1`
   *  so end-exclusive ranges are addressable. */
  origToNorm: Int32Array;
}

/** True for any char that should collapse into a whitespace run.
 *  Includes ASCII space/tab/CR/LF plus NBSP (U+00A0) — Word
 *  routinely emits NBSPs inside section numbers and around inline
 *  formatting. */
function isCollapsibleWs(ch: number): boolean {
  return (
    ch === 0x20 ||
    ch === 0x09 ||
    ch === 0x0a ||
    ch === 0x0d ||
    ch === 0x00a0
  );
}

/** Fold a single character to its ASCII equivalent when there's a
 *  clean 1:1 mapping. Multi-char folds (e.g. ellipsis → "...") are
 *  intentionally NOT done here — they'd shift `normToOrig` /
 *  `origToNorm` positions and break splice offsets. */
function foldChar(ch: string): string {
  switch (ch) {
    case "‘": // ' left single quotation mark
    case "’": // ' right single quotation mark (curly apostrophe)
    case "‚": // ‚ single low-9 quotation mark
    case "‛": // ‛ single high-reversed-9 quotation mark
      return "'";
    case "“": // " left double quotation mark
    case "”": // " right double quotation mark
    case "„": // „ double low-9 quotation mark
    case "‟": // ‟ double high-reversed-9 quotation mark
      return '"';
    case "–": // – en dash
    case "—": // — em dash
    case "−": // − minus sign
      return "-";
    default:
      return ch;
  }
}

export function normaliseWs(input: string): Normalised {
  let norm = "";
  const normToOrig: number[] = [];
  const origToNorm = new Int32Array(input.length + 1);
  let i = 0;
  while (i < input.length) {
    const ch = input.charCodeAt(i);
    if (isCollapsibleWs(ch)) {
      const runStart = i;
      while (i < input.length && isCollapsibleWs(input.charCodeAt(i))) {
        origToNorm[i] = norm.length;
        i++;
      }
      norm += " ";
      normToOrig.push(runStart);
    } else {
      origToNorm[i] = norm.length;
      // Fold smart quotes / curly apostrophes / em+en dashes to
      // ASCII so the model's reproduction matches the doc's
      // Word-default punctuation. 1:1 char swap — position maps
      // stay accurate.
      const folded = foldChar(input[i] as string);
      norm += folded;
      normToOrig.push(i);
      i++;
    }
  }
  origToNorm[input.length] = norm.length;
  return {
    norm,
    normToOrig: Int32Array.from(normToOrig),
    origToNorm,
  };
}

export type AnchorResult =
  | { kind: "ok"; paraIdx: number; origStart: number; origEnd: number }
  | { kind: "ambiguous" }
  | { kind: "not-found" };

interface ParagraphInput {
  /** Original paragraph text. */
  text: string;
  /** Pre-computed normalisation (call sites cache this). */
  norm: Normalised;
}

/** Resolve `find` (with optional context flanks) to a unique char
 *  range inside one paragraph. All inputs are *normalised* — pass
 *  `normaliseWs(...).norm` strings. */
export function locateAnchor(
  paragraphs: ParagraphInput[],
  findNorm: string,
  contextBeforeNorm: string,
  contextAfterNorm: string,
): AnchorResult {
  type Hit = {
    paraIdx: number;
    normStart: number;
    normEnd: number;
  };

  const tryAt = (cb: string, ca: string): AnchorResult => {
    const hits: Hit[] = [];
    let sawAmbiguous = false;
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const para = paragraphs[pi];
      if (!para) continue;
      const r = findUniqueInParagraph(para.norm.norm, findNorm, cb, ca);
      if (r.kind === "ambiguous") {
        sawAmbiguous = true;
        continue;
      }
      if (r.kind === "ok") {
        hits.push({ paraIdx: pi, normStart: r.start, normEnd: r.end });
      }
    }
    if (sawAmbiguous || hits.length > 1) return { kind: "ambiguous" };
    if (hits.length === 0) return { kind: "not-found" };
    const hit = hits[0];
    if (!hit) return { kind: "not-found" };
    const para = paragraphs[hit.paraIdx];
    if (!para) return { kind: "not-found" };
    const origStart = para.norm.normToOrig[hit.normStart];
    // End offset uses the next-cell trick: normToOrig only records the
    // start of each norm-char; for an exclusive end we look up the
    // next char (or fall back to the source string length).
    const origEnd =
      hit.normEnd < para.norm.normToOrig.length
        ? para.norm.normToOrig[hit.normEnd]
        : para.text.length;
    if (origStart === undefined || origEnd === undefined) {
      return { kind: "not-found" };
    }
    return { kind: "ok", paraIdx: hit.paraIdx, origStart, origEnd };
  };

  // Stage order. We never try "find + only contextAfter" if there was
  // no contextAfter provided, etc. — that would be the same as stage 3.
  const stages: Array<{ cb: string; ca: string }> = [];
  if (contextBeforeNorm && contextAfterNorm) {
    stages.push({ cb: contextBeforeNorm, ca: contextAfterNorm });
  }
  if (contextBeforeNorm) stages.push({ cb: contextBeforeNorm, ca: "" });
  if (contextAfterNorm) stages.push({ cb: "", ca: contextAfterNorm });
  stages.push({ cb: "", ca: "" });

  let sawAmbiguous = false;
  for (const { cb, ca } of stages) {
    const r = tryAt(cb, ca);
    if (r.kind === "ok") return r;
    if (r.kind === "ambiguous") sawAmbiguous = true;
  }
  return sawAmbiguous ? { kind: "ambiguous" } : { kind: "not-found" };
}

function findUniqueInParagraph(
  hay: string,
  find: string,
  contextBefore: string,
  contextAfter: string,
):
  | { kind: "ok"; start: number; end: number }
  | { kind: "ambiguous" }
  | { kind: "miss" } {
  const needle = `${contextBefore}${find}${contextAfter}`;
  if (needle.length === 0) return { kind: "miss" };

  let foundStart: number | null = null;
  let from = 0;
  while (from <= hay.length - needle.length) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    if (foundStart !== null) return { kind: "ambiguous" };
    foundStart = at;
    from = at + 1;
  }
  if (foundStart === null) return { kind: "miss" };
  const start = foundStart + contextBefore.length;
  const end = start + find.length;
  return { kind: "ok", start, end };
}
