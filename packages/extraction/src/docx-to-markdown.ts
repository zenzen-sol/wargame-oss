// .docx → markdown conversion. Verbatim port of the markdown-
// extraction half of augustus-omni/apps/local/lib/fs/docx-fs.ts. Sync
// refinements from augustus.
//
// Adaptations from the original:
//  1. Input is a Uint8Array (was filesystem path) so Convex actions
//     can pass bytes pulled from ctx.storage.
//  2. Mammoth is invoked with `{ buffer }` instead of `{ path }`.
//  3. Dynamic imports use the `.default ?? namespace` fallback so
//     the same code works under both Webpack/Turbopack (which hoists
//     CJS keys) and esbuild (which doesn't). Convex's Node-runtime
//     bundler is esbuild.
//
// The action that invokes this must declare `"use node"` because
// mammoth needs Buffer.

import { resolveDocumentNumbering } from "./docx-numbering";

/**
 * Convert .docx bytes to markdown. Preserves heading level, lists,
 * tables (via GFM), and the original section numbering. Strips bold
 * and italic emphasis runs — contract bodies should be plain prose
 * by the time they reach the agent loop.
 */
export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  // CJS interop: in Convex's Node bundler the dynamic import returns
  // a Module namespace where the real mammoth object lives on
  // `.default`. Fall back to the namespace itself for environments
  // where the export is hoisted (e.g. Bun's test runtime).
  // biome-ignore lint/suspicious/noExplicitAny: mammoth's runtime types
  const mammothMod = (await import("mammoth")) as any;
  const mammoth = mammothMod.default ?? mammothMod;
  // biome-ignore lint/suspicious/noExplicitAny: turndown CJS interop
  const turndownMod = (await import("turndown")) as any;
  const TurndownService = turndownMod.default ?? turndownMod;
  // turndown-plugin-gfm ships no types and has no DefinitelyTyped
  // package; the runtime shape is a plain plugin function.
  // @ts-expect-error untyped third-party module
  const turndownGfmMod = await import("turndown-plugin-gfm");
  // biome-ignore lint/suspicious/noExplicitAny: untyped third-party
  const { gfm } = (turndownGfmMod as any).default ?? turndownGfmMod;

  const numberByIndex = await resolveDocumentNumbering(bytes);

  let paragraphIndex = 0;
  const transformDocument = mammoth.transforms.paragraph(
    (paragraph: {
      numbering?: unknown;
      children: unknown[];
      [k: string]: unknown;
    }) => {
      const i = paragraphIndex++;
      const number = i < numberByIndex.length ? numberByIndex[i] : null;
      if (number == null) return paragraph;
      const numberRun = {
        type: "run",
        children: [{ type: "text", value: `${number}\t` }],
      };
      return {
        ...paragraph,
        numbering: null,
        children: [numberRun, ...paragraph.children],
      };
    },
  );

  // Mammoth wants a Buffer; in Node-runtime Convex actions we have
  // Buffer available. Buffer.from on a Uint8Array shares memory, so
  // there's no copy.
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = await mammoth.convertToHtml({ buffer }, { transformDocument });

  const turndown = new TurndownService({ headingStyle: "atx" });
  turndown.use(gfm);
  // Don't escape markdown special chars in bodies — contracts use them
  // (e.g. asterisks in product names, brackets in defined terms).
  turndown.escape = (s: string) => s;
  turndown.addRule("plain-emphasis", {
    filter: ["strong", "b", "em", "i"],
    replacement: (content: string) => content,
  });
  return turndown.turndown(result.value);
}
