import { describe, expect, test } from "bun:test";
import { locateAnchor, normaliseWs } from "../src/match.js";

function para(text: string) {
  return { text, norm: normaliseWs(text) };
}

describe("normaliseWs", () => {
  test("collapses internal whitespace runs to a single space", () => {
    const r = normaliseWs("foo  \t\nbar");
    expect(r.norm).toBe("foo bar");
  });

  test("maps norm offsets back to the source string", () => {
    const src = "foo  bar";
    const r = normaliseWs(src);
    // "foo bar"
    //  0123456
    // norm "bar" starts at offset 4; in source, "bar" starts at 5.
    expect(r.norm).toBe("foo bar");
    expect(r.normToOrig[4]).toBe(5);
  });

  test("treats leading whitespace as a single space", () => {
    const r = normaliseWs("   hello");
    expect(r.norm).toBe(" hello");
  });
});

describe("locateAnchor", () => {
  test("locates a unique find with full context", () => {
    const p = para("Section 1.1 The Supplier shall deliver the Services.");
    const find = normaliseWs("Supplier").norm;
    const cb = normaliseWs("The ").norm;
    const ca = normaliseWs(" shall deliver").norm;
    const r = locateAnchor([p], find, cb, ca);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.paraIdx).toBe(0);
    expect(p.text.slice(r.origStart, r.origEnd)).toBe("Supplier");
  });

  test("falls back to half-context when full context misses", () => {
    const p = para("Customer agrees to pay Supplier within thirty days.");
    // contextAfter doesn't match the text on purpose (".....DAYS." is wrong)
    const find = normaliseWs("Supplier").norm;
    const cb = normaliseWs("pay ").norm;
    const ca = normaliseWs(" XYZ").norm; // mismatched
    const r = locateAnchor([p], find, cb, ca);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(p.text.slice(r.origStart, r.origEnd)).toBe("Supplier");
  });

  test("reports ambiguous when context can't disambiguate", () => {
    const p1 = para("The Supplier shall deliver the Services.");
    const p2 = para("If the Supplier fails to deliver the Services, …");
    const find = normaliseWs("Supplier").norm;
    const r = locateAnchor([p1, p2], find, "", "");
    expect(r.kind).toBe("ambiguous");
  });

  test("reports not-found when the find string isn't in the doc", () => {
    const p = para("Section 1.1 The Supplier shall deliver the Services.");
    const find = normaliseWs("Acme Corp").norm;
    const r = locateAnchor([p], find, "", "");
    expect(r.kind).toBe("not-found");
  });

  test("tolerates whitespace drift between find and source", () => {
    // Source has a double space, model only wrote a single space.
    const p = para("pay  Supplier within");
    const find = normaliseWs("pay Supplier").norm;
    const r = locateAnchor([p], find, "", " within");
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    // Maps back to the original (the double-space variant).
    expect(p.text.slice(r.origStart, r.origEnd)).toBe("pay  Supplier");
  });
});
