/**
 * Resolve Word's auto-numbering for a .docx so that the numbers Word
 * would render (e.g. "ARTICLE 7", "7.1", "(a)") become available as
 * plain strings, keyed by the paragraph's position in document order.
 *
 * Background: mammoth's numbering reader stores only `{isOrdered,
 * level}` per level — it discards `start`, `lvlText`, and `numFmt`
 * (other than detecting bullets). For contracts that drive their
 * section numbering from `numbering.xml` (the common case), mammoth's
 * HTML output therefore contains bare `<ol><li>` items with no
 * original numbers, and turndown then renumbers each `<ol>` from 1.
 * This is fatal for legal review where every cross-reference depends
 * on the real section numbers.
 *
 * This module re-implements just enough of the OOXML numbering
 * algorithm to recover those numbers. It is intentionally read-only:
 * it never mutates the .docx, never serializes XML, and never writes
 * to disk. The output is a sparse array (one entry per paragraph in
 * document order, `null` if the paragraph is not numbered) that the
 * caller can hand to mammoth's official `transformDocument` API to
 * inject the numbers as ordinary text runs.
 *
 * Verbatim port of augustus-omni/apps/local/lib/fs/docx-numbering.ts.
 * Algorithm and OOXML coverage are unchanged; the sole adaptation is
 * the entry point — augustus reads from a filesystem path, this
 * version takes a Uint8Array so Convex actions can pass bytes pulled
 * from ctx.storage directly. Sync future refinements from augustus
 * first.
 *
 * Failure mode unchanged: every error path returns "no numbering",
 * never throws.
 */

import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";

// xmldom's DOM types do not extend the lib.dom Node interface, so the
// generic helpers below take `any` for the input nodes. Inside the
// helpers we only touch the small subset of DOM API that xmldom
// implements correctly.
// biome-ignore lint/suspicious/noExplicitAny: xmldom typing limitation
type XmlNode = any;

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

interface LvlDef {
  start: number;
  numFmt: string;
  lvlText: string;
}

interface AbstractNum {
  levels: Map<number, LvlDef>;
  numStyleLink: string | null;
}

interface ParsedNumbering {
  resolveBaseNumId(numId: string): string | null;
  resolveLevel(numId: string, ilvl: number): LvlDef | null;
}

/**
 * Compute the rendered Word number for each paragraph in
 * `document.xml`, keyed by paragraph position in document order. The
 * returned array length equals the total number of `<w:p>` elements
 * in the document, including empty paragraphs and section-properties-
 * only paragraphs.
 */
export async function resolveDocumentNumbering(
  bytes: Uint8Array,
): Promise<(string | null)[]> {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch {
    return [];
  }

  const docXmlBytes = zip["word/document.xml"];
  if (!docXmlBytes) return [];
  const docXml = strFromU8(docXmlBytes);

  const numXml = zip["word/numbering.xml"]
    ? strFromU8(zip["word/numbering.xml"])
    : "";
  const stylesXml = zip["word/styles.xml"]
    ? strFromU8(zip["word/styles.xml"])
    : "";

  const parsed = numXml ? safeParseNumbering(numXml, stylesXml) : null;
  const next = parsed ? buildResolver(parsed) : () => null;

  const parser = new DOMParser({
    onError: () => {
      /* swallow — treat malformed XML as "no numbering" */
    },
  });

  let doc: XmlNode;
  try {
    doc = parser.parseFromString(docXml, "text/xml");
  } catch {
    return [];
  }

  const result: (string | null)[] = [];
  walkParagraphs(doc, (paragraph) => {
    const pPr = firstChildNS(paragraph, W_NS, "pPr");
    const numPr = pPr ? firstChildNS(pPr, W_NS, "numPr") : null;
    if (!numPr) {
      result.push(null);
      return;
    }
    const numIdEl = firstChildNS(numPr, W_NS, "numId");
    const ilvlEl = firstChildNS(numPr, W_NS, "ilvl");
    const numId = numIdEl?.getAttributeNS(W_NS, "val");
    if (!numId) {
      result.push(null);
      return;
    }
    const ilvl = ilvlEl
      ? Number.parseInt(ilvlEl.getAttributeNS(W_NS, "val") ?? "0", 10)
      : 0;
    result.push(next(numId, Number.isFinite(ilvl) ? ilvl : 0));
  });

  return result;
}

// ---------------------------------------------------------------------------
// Numbering parsing
// ---------------------------------------------------------------------------

function safeParseNumbering(
  numXml: string,
  stylesXml: string,
): ParsedNumbering | null {
  try {
    return parseNumbering(numXml, stylesXml);
  } catch {
    return null;
  }
}

function parseNumbering(numXml: string, stylesXml: string): ParsedNumbering {
  const parser = new DOMParser({ onError: () => {} });
  const numDoc = parser.parseFromString(numXml, "text/xml");
  const stylesDoc = stylesXml
    ? parser.parseFromString(stylesXml, "text/xml")
    : null;

  const abstractNums = new Map<string, AbstractNum>();
  for (const el of getElementsByLocalName(numDoc, "abstractNum")) {
    const id = el.getAttributeNS(W_NS, "abstractNumId");
    if (!id) continue;
    const levels = new Map<number, LvlDef>();
    for (const child of childElements(el)) {
      if (child.localName !== "lvl" || child.namespaceURI !== W_NS) continue;
      const def = parseLvl(child);
      if (def) levels.set(def.ilvl, def.def);
    }
    const numStyleLinkEl = firstChildNS(el, W_NS, "numStyleLink");
    abstractNums.set(id, {
      levels,
      numStyleLink: numStyleLinkEl?.getAttributeNS(W_NS, "val") ?? null,
    });
  }

  const nums = new Map<string, string>();
  for (const el of getElementsByLocalName(numDoc, "num")) {
    const numId = el.getAttributeNS(W_NS, "numId");
    if (!numId) continue;
    const aEl = firstChildNS(el, W_NS, "abstractNumId");
    const aid = aEl?.getAttributeNS(W_NS, "val");
    if (aid) nums.set(numId, aid);
  }

  const numberingStyles = new Map<string, string>();
  if (stylesDoc) {
    for (const el of getElementsByLocalName(stylesDoc, "style")) {
      if (el.getAttributeNS(W_NS, "type") !== "numbering") continue;
      const styleId = el.getAttributeNS(W_NS, "styleId");
      if (!styleId) continue;
      const pPr = firstChildNS(el, W_NS, "pPr");
      if (!pPr) continue;
      const numPr = firstChildNS(pPr, W_NS, "numPr");
      if (!numPr) continue;
      const numIdEl = firstChildNS(numPr, W_NS, "numId");
      const numId = numIdEl?.getAttributeNS(W_NS, "val");
      if (numId) numberingStyles.set(styleId, numId);
    }
  }

  function resolveBaseNumId(
    numId: string,
    seen: Set<string> = new Set(),
  ): string | null {
    if (seen.has(numId)) return null;
    seen.add(numId);
    const aid = nums.get(numId);
    if (!aid) return null;
    const abs = abstractNums.get(aid);
    if (!abs) return null;
    if (abs.numStyleLink) {
      const next = numberingStyles.get(abs.numStyleLink);
      if (next && next !== numId) return resolveBaseNumId(next, seen);
    }
    return numId;
  }

  function resolveLevel(
    numId: string,
    ilvl: number,
    seen: Set<string> = new Set(),
  ): LvlDef | null {
    if (seen.has(numId)) return null;
    seen.add(numId);
    const aid = nums.get(numId);
    if (!aid) return null;
    const abs = abstractNums.get(aid);
    if (!abs) return null;
    if (abs.numStyleLink) {
      const next = numberingStyles.get(abs.numStyleLink);
      if (next && next !== numId) return resolveLevel(next, ilvl, seen);
      return null;
    }
    return abs.levels.get(ilvl) ?? null;
  }

  return { resolveBaseNumId, resolveLevel };
}

function parseLvl(lvl: XmlNode): { ilvl: number; def: LvlDef } | null {
  const ilvlAttr = lvl.getAttributeNS(W_NS, "ilvl");
  if (ilvlAttr == null) return null;
  const ilvl = Number.parseInt(ilvlAttr, 10);
  if (!Number.isFinite(ilvl)) return null;
  const startEl = firstChildNS(lvl, W_NS, "start");
  const numFmtEl = firstChildNS(lvl, W_NS, "numFmt");
  const lvlTextEl = firstChildNS(lvl, W_NS, "lvlText");
  return {
    ilvl,
    def: {
      start: startEl
        ? Number.parseInt(startEl.getAttributeNS(W_NS, "val") ?? "1", 10) || 1
        : 1,
      numFmt: numFmtEl?.getAttributeNS(W_NS, "val") ?? "decimal",
      lvlText: lvlTextEl?.getAttributeNS(W_NS, "val") ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// Counter advancement and number formatting
// ---------------------------------------------------------------------------

function buildResolver(
  parsed: ParsedNumbering,
): (numId: string, ilvl: number) => string | null {
  const counters = new Map<string, number[]>();
  function getCounters(baseNumId: string): number[] {
    let c = counters.get(baseNumId);
    if (!c) {
      c = new Array(9).fill(-1);
      counters.set(baseNumId, c);
    }
    return c;
  }

  return function next(numId, ilvl) {
    const baseNumId = parsed.resolveBaseNumId(numId);
    if (!baseNumId) return null;
    const def = parsed.resolveLevel(numId, ilvl);
    if (!def) return null;
    if (def.numFmt === "bullet") return null;

    if (ilvl < 0 || ilvl >= 9) return null;
    const c = getCounters(baseNumId);
    const current = c[ilvl] ?? -1;
    c[ilvl] = current < 0 ? def.start : current + 1;

    for (let deeper = ilvl + 1; deeper < c.length; deeper++) {
      c[deeper] = -1;
    }

    return formatLvlText(def.lvlText, numId, c, parsed);
  };
}

function formatLvlText(
  template: string,
  numId: string,
  counters: number[],
  parsed: ParsedNumbering,
): string {
  let text = template;
  for (let k = 1; k <= 9; k++) {
    const placeholder = `%${k}`;
    if (!text.includes(placeholder)) continue;
    const refIlvl = k - 1;
    const refDef = parsed.resolveLevel(numId, refIlvl);
    if (!refDef) {
      text = text.split(placeholder).join("");
      continue;
    }
    const current = counters[refIlvl] ?? -1;
    const value = current >= 0 ? current : refDef.start;
    text = text.split(placeholder).join(formatNumber(value, refDef.numFmt));
  }
  return text;
}

function formatNumber(value: number, fmt: string): string {
  switch (fmt) {
    case "decimal":
      return String(value);
    case "decimalZero":
      return value < 10 ? `0${value}` : String(value);
    case "lowerLetter":
      return toLetter(value, false);
    case "upperLetter":
      return toLetter(value, true);
    case "lowerRoman":
      return toRoman(value).toLowerCase();
    case "upperRoman":
      return toRoman(value);
    default:
      return String(value);
  }
}

function toLetter(n: number, upper: boolean): string {
  if (n < 1) return "";
  const base = upper ? 65 : 97;
  const letterIndex = (n - 1) % 26;
  const repeat = Math.floor((n - 1) / 26) + 1;
  return String.fromCharCode(base + letterIndex).repeat(repeat);
}

function toRoman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  const map: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let s = "";
  let v = n;
  for (const [step, sym] of map) {
    while (v >= step) {
      s += sym;
      v -= step;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function firstChildNS(
  el: XmlNode,
  ns: string,
  localName: string,
): XmlNode | null {
  for (const child of childElements(el)) {
    if (child.localName === localName && child.namespaceURI === ns) {
      return child;
    }
  }
  return null;
}

function childElements(el: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  const children = el.childNodes;
  if (!children) return out;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c && c.nodeType === 1) out.push(c);
  }
  return out;
}

function getElementsByLocalName(root: XmlNode, localName: string): XmlNode[] {
  const out: XmlNode[] = [];
  function recurse(node: XmlNode) {
    if (node.nodeType === 1) {
      if (node.localName === localName && node.namespaceURI === W_NS) {
        out.push(node);
      }
    }
    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c) recurse(c);
      }
    }
  }
  recurse(root);
  return out;
}

/**
 * Walk every `<w:p>` in the document in document order. Visits
 * paragraphs inside table cells (and any other container) at the
 * position they appear, which is the same order mammoth's
 * `transformDocument` visits them — that alignment is what makes
 * index-based correlation safe.
 */
function walkParagraphs(root: XmlNode, visit: (p: XmlNode) => void): void {
  function recurse(node: XmlNode) {
    if (node.nodeType === 1) {
      if (node.localName === "p" && node.namespaceURI === W_NS) {
        visit(node);
        return; // paragraphs cannot contain other paragraphs in OOXML
      }
    }
    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c) recurse(c);
      }
    }
  }
  recurse(root);
}
