// XML parser/builder configuration + preserve-order helpers.
//
// We use fast-xml-parser in `preserveOrder` mode so the OOXML round-
// trips byte-for-byte (ish) — element order inside a paragraph and
// inside a run matters for Word, and a key-keyed object representation
// can't preserve it. In this mode, each node is a one-key object:
//
//   { "w:p": [ ...children ], ":@": { "@_w:rsidR": "00ABCDEF" } }
//   { "#text": "Hello" }
//
// `:@` is the attributes bag, `#text` is text content. These helpers
// abstract the gory key juggling so the rest of the engine reads
// cleanly.

import { XMLBuilder, XMLParser } from "fast-xml-parser";

export const ATTR_KEY = ":@";
export const TEXT_KEY = "#text";

export type XNode = Record<string, unknown>;
export type XTree = XNode[];

const PARSER_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Word XML has many self-closing tags (`<w:br/>`, `<w:tab/>`). The
  // parser's default `allowBooleanAttributes` works against us here;
  // explicit `parseTagValue: false` keeps numeric-looking text from
  // being coerced to a number.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // The XML declaration ('<?xml ... ?>') is preserved as its own node.
  // We keep it so writes don't drop it.
  processEntities: true,
} as const;

const BUILDER_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  suppressEmptyNode: false,
  format: false,
  // fast-xml-parser strips the XML declaration in build by default
  // unless re-emitted. We add it back in `serializeDocument` below.
} as const;

const parser = new XMLParser(PARSER_OPTIONS);
const builder = new XMLBuilder(BUILDER_OPTIONS);

export function parseDocument(xml: string): XTree {
  return parser.parse(xml) as XTree;
}

export function serializeDocument(tree: XTree): string {
  const body = builder.build(tree);
  // Word expects a UTF-8 declaration at the top. fast-xml-parser
  // drops it on serialisation in preserveOrder mode, so we restore it.
  if (body.startsWith("<?xml")) return body;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

// ---------------------------------------------------------------------------
// Node walking
// ---------------------------------------------------------------------------

/** The element name of a preserve-order node, or null for a text or
 *  attributes node. */
export function elName(n: unknown): string | null {
  if (!n || typeof n !== "object") return null;
  for (const k of Object.keys(n as XNode)) {
    if (k === ATTR_KEY || k === TEXT_KEY) continue;
    return k;
  }
  return null;
}

export function isTextNode(n: unknown): n is { [TEXT_KEY]: string } {
  if (!n || typeof n !== "object") return false;
  const obj = n as XNode;
  return TEXT_KEY in obj && elName(n) === null;
}

export function elChildren(n: unknown): XNode[] {
  const name = elName(n);
  if (!name) return [];
  const v = (n as XNode)[name];
  return Array.isArray(v) ? (v as XNode[]) : [];
}

export function setChildren(n: XNode, children: XNode[]): void {
  const name = elName(n);
  if (!name) return;
  n[name] = children;
}

export function elAttrs(n: unknown): Record<string, string> {
  if (!n || typeof n !== "object") return {};
  const a = (n as XNode)[ATTR_KEY];
  return (a as Record<string, string>) ?? {};
}

/** Build an element node with optional children + attributes. The
 *  attributes object uses bare keys (e.g., `{ "xml:space": "preserve" }`)
 *  and we prefix them with `@_` internally. */
export function makeEl(
  name: string,
  children: XNode[] = [],
  attrs?: Record<string, string>,
): XNode {
  const el: XNode = { [name]: children };
  if (attrs) {
    const attrObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
      attrObj[`@_${k}`] = v;
    }
    el[ATTR_KEY] = attrObj;
  }
  return el;
}

export function makeText(s: string): XNode {
  return { [TEXT_KEY]: s };
}

export function cloneNode<T>(n: T): T {
  return JSON.parse(JSON.stringify(n)) as T;
}

/** Walk the entire tree (depth-first) yielding every element node. */
export function* walkElements(tree: XTree | XNode): Generator<XNode> {
  const stack: XNode[] = Array.isArray(tree) ? [...tree] : [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (!elName(node)) continue;
    yield node;
    const kids = elChildren(node);
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k) stack.push(k);
    }
  }
}
