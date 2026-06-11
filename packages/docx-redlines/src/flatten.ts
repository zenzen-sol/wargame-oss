// Paragraph flattening.
//
// A Word paragraph is a sequence of `<w:r>` runs, each carrying any
// number of `<w:t>` text nodes interleaved with `<w:br>` / `<w:tab>`
// and other run children. To locate a `find` substring we need the
// paragraph's text as one continuous char stream plus a way to map
// each char back to (run, text-node, offset) so the planner can edit
// the right OOXML pieces.
//
// We also handle pre-existing tracked changes by presenting the
// paragraph in *accepted view*: `<w:ins>` wrappers are unwrapped (their
// inner runs contribute text); `<w:del>` wrappers are skipped (their
// inner text is invisible in the accepted view).

import { TEXT_KEY, elChildren, elName, type XNode } from "./xml";

/** Per-run flattening output. */
export interface RunSlot {
  /** Index in `paragraph.children` where this run (or its `<w:ins>`
   *  wrapper) lives. Multiple slots may share `childIndex` when the
   *  wrapper holds several runs — see `wrapper` below. */
  childIndex: number;
  /** When set, the slot's run lives inside this top-level wrapper
   *  element (e.g., `<w:ins>`). Reconstruction can drop the wrapper
   *  whole when a new edit touches any of its inner runs. */
  wrapper?: "w:ins";
  /** Reference to the run's `<w:rPr>` element so we can clone it when
   *  emitting new `<w:r>` runs for the replacement text. Null if the
   *  source run had no properties. */
  rPr: XNode | null;
  /** Per-`<w:t>` text-node info in the order the run holds them. The
   *  paragraph offsets are inclusive-start, exclusive-end. */
  textNodes: TextNodeSlot[];
}

export interface TextNodeSlot {
  /** Reference to the `<w:t>` element. */
  wtEl: XNode;
  /** Plain text content of this `<w:t>`. */
  text: string;
  /** Inclusive start offset into `paraText`. */
  paraStart: number;
  /** Exclusive end offset into `paraText`. */
  paraEnd: number;
}

export interface Flattened {
  /** Paragraph text in accepted view, with all `<w:t>` content
   *  concatenated in paragraph order. */
  paraText: string;
  /** For each char in `paraText`: which run slot it belongs to. */
  charRun: Int32Array;
  /** For each char: which text-node within that slot. */
  charTextNode: Int32Array;
  /** For each char: offset within that text-node's `text`. */
  charOffset: Int32Array;
  /** Run slots in paragraph order. */
  runs: RunSlot[];
}

export function flattenParagraph(paraChildren: XNode[]): Flattened {
  const runs: RunSlot[] = [];
  let paraText = "";
  const charRunArr: number[] = [];
  const charTextNodeArr: number[] = [];
  const charOffsetArr: number[] = [];

  const processRun = (
    rEl: XNode,
    topChildIdx: number,
    wrapper: RunSlot["wrapper"],
  ) => {
    const rKids = elChildren(rEl);
    let rPr: XNode | null = null;
    const textNodes: TextNodeSlot[] = [];
    for (const rk of rKids) {
      const name = elName(rk);
      if (name === "w:rPr") {
        rPr = rk;
      } else if (name === "w:t") {
        const txt = getTextContent(rk);
        const start = paraText.length;
        textNodes.push({
          wtEl: rk,
          text: txt,
          paraStart: start,
          paraEnd: start + txt.length,
        });
        const runIdx = runs.length;
        const tnIdx = textNodes.length - 1;
        paraText += txt;
        for (let i = 0; i < txt.length; i++) {
          charRunArr.push(runIdx);
          charTextNodeArr.push(tnIdx);
          charOffsetArr.push(i);
        }
      }
      // other run children (w:tab, w:br, w:sym, …) are left alone —
      // they don't contribute to the char stream, so a `find` string
      // never matches across them.
    }
    runs.push({ childIndex: topChildIdx, wrapper, rPr, textNodes });
  };

  for (let ci = 0; ci < paraChildren.length; ci++) {
    const child = paraChildren[ci];
    if (!child) continue;
    const name = elName(child);
    if (name === "w:r") {
      processRun(child, ci, undefined);
    } else if (name === "w:ins") {
      // Accepted view: include inner runs as if bare. `childIndex`
      // still points at the wrapper so reconstruction can drop it
      // whole when a new edit lands here.
      for (const inner of elChildren(child)) {
        if (elName(inner) === "w:r") processRun(inner, ci, "w:ins");
      }
    }
    // w:del: skipped entirely — accepted view excludes deleted text.
  }

  return {
    paraText,
    charRun: Int32Array.from(charRunArr),
    charTextNode: Int32Array.from(charTextNodeArr),
    charOffset: Int32Array.from(charOffsetArr),
    runs,
  };
}

function getTextContent(wtEl: XNode): string {
  let out = "";
  for (const k of elChildren(wtEl)) {
    if (
      k &&
      typeof k === "object" &&
      TEXT_KEY in k &&
      elName(k) === null
    ) {
      out += String((k as { [TEXT_KEY]: unknown })[TEXT_KEY] ?? "");
    }
  }
  return out;
}
