import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { applyTrackedEdits } from "../src/index.js";
import { buildDocx, paragraphFromRuns, readDocumentXml } from "./fixtures.js";

describe("applyTrackedEdits — round-trip", () => {
  test("round-trips an unmodified .docx when there are no edits", async () => {
    const source = await buildDocx([
      paragraphFromRuns([
        "The Supplier shall deliver the Services within thirty (30) days.",
      ]),
    ]);

    const result = await applyTrackedEdits({
      bytes: source,
      edits: [],
      author: "Blue",
    });

    expect(result.changes).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    const xml = await readDocumentXml(result.bytes);
    expect(xml).toContain(
      "The Supplier shall deliver the Services within thirty (30) days.",
    );
  });

  test("throws on archives missing word/document.xml", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "not a docx");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });

    await expect(
      applyTrackedEdits({ bytes, edits: [], author: "Blue" }),
    ).rejects.toThrow(/missing word\/document\.xml/);
  });
});

describe("applyTrackedEdits — simple substitution", () => {
  test("writes a single-run substitution as w:del + w:ins", async () => {
    const source = await buildDocx([
      paragraphFromRuns(["Confidentiality term: five (5) years."]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "five (5)",
          replace: "three (3)",
          contextBefore: "Confidentiality term: ",
          contextAfter: " years.",
          reason: "Reduce confidentiality period.",
        },
      ],
      author: "Red",
      date: "2026-05-12T00:00:00Z",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0];
    if (!change) throw new Error("expected exactly one change");
    expect(change.deletedText).toBe("five (5)");
    expect(change.insertedText).toBe("three (3)");
    expect(change.delWId).toBeDefined();
    expect(change.insWId).toBeDefined();

    const xml = await readDocumentXml(result.bytes);
    expect(xml).toContain("<w:del");
    expect(xml).toContain("<w:delText");
    expect(xml).toContain("five (5)");
    expect(xml).toContain("<w:ins");
    expect(xml).toContain("three (3)");
    expect(xml).toContain('w:author="Red"');
    expect(xml).toContain('w:date="2026-05-12T00:00:00Z"');
  });

  test("emits monotonically increasing w:ids across multiple edits", async () => {
    const source = await buildDocx([
      paragraphFromRuns(["Section 1.1: foo."]),
      paragraphFromRuns(["Section 2.1: bar."]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "foo",
          replace: "alpha",
          contextBefore: "Section 1.1: ",
          contextAfter: ".",
        },
        {
          find: "bar",
          replace: "beta",
          contextBefore: "Section 2.1: ",
          contextAfter: ".",
        },
      ],
      author: "Blue",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.changes).toHaveLength(2);
    const ids = result.changes
      .flatMap((c) => [c.delWId, c.insWId])
      .filter((x): x is string => !!x)
      .map((s) => Number.parseInt(s, 10));
    const sorted = [...ids].sort((a, b) => a - b);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(sorted).toEqual(ids.sort((a, b) => a - b));
  });
});

describe("applyTrackedEdits — pure operations", () => {
  test("pure deletion: replace empty", async () => {
    const source = await buildDocx([
      paragraphFromRuns(["This phrase, including the parenthetical, stays."]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: ", including the parenthetical,",
          replace: "",
          contextBefore: "This phrase",
          contextAfter: " stays.",
        },
      ],
      author: "Blue",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0];
    if (!change) throw new Error("expected exactly one change");
    expect(change.deletedText).toBe(", including the parenthetical,");
    expect(change.insertedText).toBe("");
    expect(change.delWId).toBeDefined();
    expect(change.insWId).toBeUndefined();

    const xml = await readDocumentXml(result.bytes);
    expect(xml).toContain("<w:del");
    expect(xml).not.toContain("<w:ins");
  });

  test("pure insertion: find empty, anchored by contextBefore + contextAfter", async () => {
    const source = await buildDocx([
      paragraphFromRuns(["The Supplier shall deliver promptly."]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "",
          replace: " the Services",
          contextBefore: "shall deliver",
          contextAfter: " promptly.",
        },
      ],
      author: "Blue",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0];
    if (!change) throw new Error("expected exactly one change");
    expect(change.deletedText).toBe("");
    expect(change.insertedText).toBe(" the Services");
    expect(change.delWId).toBeUndefined();
    expect(change.insWId).toBeDefined();

    const xml = await readDocumentXml(result.bytes);
    expect(xml).not.toContain("<w:del");
    expect(xml).toContain("<w:ins");
    expect(xml).toContain("the Services");
  });
});

describe("applyTrackedEdits — multi-run spans", () => {
  test("replacement that spans multiple runs in the same paragraph", async () => {
    // Three runs: "Section 9.1 " · "Confidentiality" · " term: five years."
    const source = await buildDocx([
      paragraphFromRuns([
        "Section 9.1 ",
        "Confidentiality",
        " term: five years.",
      ]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "Confidentiality term: five years",
          replace: "Confidentiality term: three years",
          contextBefore: "Section 9.1 ",
          contextAfter: ".",
        },
      ],
      author: "Red",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.changes).toHaveLength(1);
    const xml = await readDocumentXml(result.bytes);
    expect(xml).toContain("Confidentiality term: five years");
    expect(xml).toContain("Confidentiality term: three years");
    expect(xml).toContain("<w:del");
    expect(xml).toContain("<w:ins");
  });
});

describe("applyTrackedEdits — anchor failures", () => {
  test("reports ambiguous matches without applying any edit", async () => {
    const source = await buildDocx([
      paragraphFromRuns(["The Supplier shall deliver."]),
      paragraphFromRuns(["If the Supplier fails, …"]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "Supplier",
          replace: "Vendor",
          contextBefore: "",
          contextAfter: "",
        },
      ],
      author: "Blue",
    });
    expect(result.changes).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toMatch(/Ambiguous/);
  });

  test("reports not-found without applying any edit", async () => {
    const source = await buildDocx([
      paragraphFromRuns(["Section 1.1 is short."]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "Acme Corp",
          replace: "Globex Ltd",
          contextBefore: "",
          contextAfter: "",
        },
      ],
      author: "Blue",
    });
    expect(result.changes).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toMatch(/Could not locate/);
  });

  test("rejects overlapping edits in the same paragraph but applies non-overlapping ones", async () => {
    const source = await buildDocx([
      paragraphFromRuns(["alpha beta gamma delta"]),
    ]);
    const result = await applyTrackedEdits({
      bytes: source,
      edits: [
        {
          find: "alpha beta",
          replace: "ALPHA BETA",
          contextBefore: "",
          contextAfter: " gamma",
        },
        {
          find: "beta gamma",
          replace: "BETA GAMMA",
          contextBefore: "alpha ",
          contextAfter: " delta",
        },
        {
          find: "delta",
          replace: "DELTA",
          contextBefore: "gamma ",
          contextAfter: "",
        },
      ],
      author: "Blue",
    });
    // First two overlap; the third doesn't. We accept the first
    // (leftmost) and reject the second; the third lands.
    expect(result.changes).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toMatch(/overlaps/);
  });
});
