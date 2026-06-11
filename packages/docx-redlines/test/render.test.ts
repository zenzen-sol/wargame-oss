import { describe, expect, test } from "bun:test";
import { renderAcceptedView } from "../src/index.js";
import { buildDocx, paragraphFromRuns } from "./fixtures.js";

describe("renderAcceptedView", () => {
  test("flattens each paragraph's run text in document order", async () => {
    const bytes = await buildDocx([
      paragraphFromRuns(["Section 1.1 ", "The Supplier shall deliver."]),
      paragraphFromRuns(["Section 1.2 Payment is due in thirty days."]),
    ]);
    const rendered = await renderAcceptedView(bytes);
    expect(rendered.paragraphs).toHaveLength(2);
    expect(rendered.paragraphs[0]?.text).toBe(
      "Section 1.1 The Supplier shall deliver.",
    );
    expect(rendered.paragraphs[1]?.text).toBe(
      "Section 1.2 Payment is due in thirty days.",
    );
    expect(rendered.asMarkdown).toContain("Section 1.1");
    expect(rendered.asMarkdown).toContain("\n\n");
  });

  test("renders the accepted view after tracked edits are applied", async () => {
    const { applyTrackedEdits } = await import("../src/index.js");
    const source = await buildDocx([
      paragraphFromRuns(["Confidentiality term: five (5) years."]),
    ]);
    const { bytes } = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "five (5)",
          replace: "three (3)",
          contextBefore: "Confidentiality term: ",
          contextAfter: " years.",
        },
      ],
      author: "Red",
    });
    const rendered = await renderAcceptedView(bytes);
    // The accepted view collapses w:del (the original "five (5)" is
    // hidden) and unwraps w:ins (so "three (3)" appears as normal
    // text). The agent's prompt sees the post-edit state.
    expect(rendered.paragraphs[0]?.text).toBe(
      "Confidentiality term: three (3) years.",
    );
  });
});
