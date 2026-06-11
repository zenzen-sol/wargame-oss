import { describe, expect, test } from "bun:test";
import { cleanPartyName, normalizeParties, normalizeTitle } from "./clean";

describe("normalizeTitle", () => {
  test("title-cases a lowercased input", () => {
    expect(normalizeTitle("master license agreement")).toBe(
      "Master License Agreement",
    );
  });

  test("preserves acronyms in the allow-list", () => {
    expect(normalizeTitle("mutual nda")).toBe("Mutual NDA");
    expect(normalizeTitle("simple safe")).toBe("Simple SAFE");
    expect(normalizeTitle("master sow")).toBe("Master SOW");
  });

  test("returns null for placeholder-shaped input", () => {
    expect(normalizeTitle("")).toBeNull();
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("TBD")).toBeNull();
    expect(normalizeTitle("To be named")).toBeNull();
    expect(normalizeTitle("___")).toBeNull();
  });
});

describe("cleanPartyName", () => {
  test("strips surrounding brackets but does not flag bare role labels as placeholders", () => {
    // The cleaner does not invent placeholder semantics for bare role
    // labels — that's the LLM's job (isPlaceholder=true at extraction
    // time). The cleaner only catches obvious template artifacts like
    // ____ or TBD.
    expect(cleanPartyName("[Customer]")).toBe("Customer");
  });

  test("strips template filler and preserves original case", () => {
    // Intentionally does NOT titleize. Acronyms (KBB, IBM, FINRA) and
    // brand marks (iPhone, NASDAQ) defy simple casing rules; the model
    // sees the original contract and is the source of truth for case.
    expect(cleanPartyName("INSERT FULL SUPPLIER NAME")).toBe("SUPPLIER");
  });

  test("strips trailing role restatement", () => {
    expect(cleanPartyName('Acme Corp (the "Customer")')).toBe("Acme Corp");
  });

  test("strips trailing jurisdiction phrase", () => {
    expect(cleanPartyName("Acme Corp, a Delaware corporation")).toBe(
      "Acme Corp",
    );
  });

  test("strips surrounding straight quotes", () => {
    expect(cleanPartyName('"Acme Corp"')).toBe("Acme Corp");
  });

  test("strips surrounding curly quotes", () => {
    expect(cleanPartyName("“Acme Corp”")).toBe("Acme Corp");
  });

  test("returns empty for placeholder-shaped names", () => {
    expect(cleanPartyName("TBD")).toBe("");
    expect(cleanPartyName("____")).toBe("");
    expect(cleanPartyName("N/A")).toBe("");
  });

  test("preserves capitalization for real names (does not titleize)", () => {
    expect(cleanPartyName("iPhone Holdings, Inc.")).toBe(
      "iPhone Holdings, Inc",
    );
    expect(cleanPartyName("KBB Industries LLC")).toBe("KBB Industries LLC");
  });
});

describe("normalizeParties", () => {
  test("canonicalizes role labels", () => {
    const out = normalizeParties([
      { name: "Acme", role: "buyer", isPlaceholder: false },
    ]);
    expect(out[0]?.role).toBe("Buyer");
  });

  test("flips isPlaceholder when cleaning empties the name", () => {
    const out = normalizeParties([
      { name: "TBD", role: "Customer", isPlaceholder: false },
    ]);
    expect(out[0]).toEqual({
      name: "",
      role: "Customer",
      isPlaceholder: true,
    });
  });

  test("drops parties with no name and no role", () => {
    const out = normalizeParties([
      { name: "", role: "", isPlaceholder: true },
    ]);
    expect(out).toEqual([]);
  });

  test("keeps a party with a role even when the name was a placeholder", () => {
    const out = normalizeParties([
      { name: "", role: "Customer", isPlaceholder: true },
    ]);
    expect(out[0]).toEqual({
      name: "",
      role: "Customer",
      isPlaceholder: true,
    });
  });

  test("multiple parties with the same role each get their own entry", () => {
    const out = normalizeParties([
      { name: "Alpha Capital", role: "Investor", isPlaceholder: false },
      { name: "Beta Ventures", role: "Investor", isPlaceholder: false },
    ]);
    expect(out).toEqual([
      { name: "Alpha Capital", role: "Investor", isPlaceholder: false },
      { name: "Beta Ventures", role: "Investor", isPlaceholder: false },
    ]);
  });
});
