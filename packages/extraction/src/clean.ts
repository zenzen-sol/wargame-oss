// Verbatim port of augustus-omni/apps/local/lib/extraction.ts. This
// pipeline has been refined in place there; future changes should
// land in augustus first, then be re-synced here so the two stay
// bit-for-bit identical. No DB calls, no LLM calls. Tests next door.

import { titleCase } from "title-case";

export interface ExtractedParty {
  /** Cleaned legal entity name. Empty string when the contract contained
   *  only a templated placeholder for this party — in that case the
   *  `role` is what we surface to the user until they name it. */
  name: string;
  /** Canonical role label, title case, singular (e.g. "Licensor"). */
  role: string;
  /** True when the contract had only templated placeholder language for
   *  this party (e.g. "[Customer Name]", "INSERT SUPPLIER"). */
  isPlaceholder: boolean;
}

// ---------------------------------------------------------------------------
// Title normalization
// ---------------------------------------------------------------------------

const PRESERVED_ACRONYMS = new Set([
  "SAFE",
  "NDA",
  "NDNDA",
  "MSA",
  "MNDA",
  "SOW",
  "EULA",
  "LLC",
  "LLP",
  "LP",
  "PLC",
  "GP",
  "PC",
  "PA",
  "DPA",
  "BAA",
  "API",
  "SaaS",
  "IP",
  "RFP",
  "RFI",
  "POC",
  "MOU",
  "LOI",
  "Y&I",
]);

/**
 * Force a generated contract title into sensible casing. Lowercase
 * first so the title-case package can re-capitalize, then restore
 * acronyms from the allow-list. Returns null if the title is empty
 * or looks placeholder.
 */
export function normalizeTitle(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (looksLikePlaceholder(trimmed)) return null;
  const cased = titleCase(trimmed.toLowerCase());
  return cased.replace(/\b[a-zA-Z&]+\b/g, (word) => {
    const upper = word.toUpperCase();
    return PRESERVED_ACRONYMS.has(upper) ? upper : word;
  });
}

// ---------------------------------------------------------------------------
// Party normalization
// ---------------------------------------------------------------------------

/** Filler tokens that show up inside template brackets; stripped entirely. */
const PLACEHOLDER_FILLER =
  /\b(INSERT|INSERTED|FULL|LEGAL|COMPLETE|NAME|NAMED|NAMES|ENTITY|COMPANY\s+NAME|CORPORATE\s+NAME|TBD|TO\s+BE\s+(?:NAMED|DETERMINED|PROVIDED|INSERTED))\b/gi;

/** Signals that a whole name is nothing but a template artifact. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^_+$/,
  /^-+$/,
  /^\.+$/,
  /^\[\s*\]$/,
  /^\(\s*\)$/,
  /^tbd\.?$/i,
  /^to\s+be\s+(named|determined|provided|inserted)\.?$/i,
  /^n\/?a$/i,
  /^none$/i,
  /^unknown$/i,
  /^\s*$/,
];

function looksLikePlaceholder(s: string): boolean {
  const t = s.trim();
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

const ROLE_LABEL_CANONICAL: Record<string, string> = {
  buyer: "Buyer",
  seller: "Seller",
  licensor: "Licensor",
  licensee: "Licensee",
  customer: "Customer",
  supplier: "Supplier",
  vendor: "Vendor",
  investor: "Investor",
  company: "Company",
  employer: "Employer",
  employee: "Employee",
  contractor: "Contractor",
  "disclosing party": "Disclosing Party",
  "receiving party": "Receiving Party",
  lender: "Lender",
  borrower: "Borrower",
  landlord: "Landlord",
  tenant: "Tenant",
  purchaser: "Purchaser",
  client: "Client",
  consultant: "Consultant",
};

function normalizeRole(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return ROLE_LABEL_CANONICAL[key] ?? titleCase(key);
}

/**
 * Strip a party name down to the real entity. Handles:
 *  - surrounding brackets: "[Customer]" → "Customer" (then flagged as placeholder)
 *  - INSERT / FULL / NAME filler: "INSERT FULL SUPPLIER NAME" → "Supplier"
 *  - trailing role restatement: 'Acme Corp (the "Customer")' → "Acme Corp"
 *  - trailing jurisdiction phrase: "Acme Corp, a Delaware corporation" → "Acme Corp"
 *  - quotes around the whole thing: '"Acme Corp"' → "Acme Corp"
 *  - ALL-CAPS role labels: "CUSTOMER" → "Customer"
 *
 * Returns an empty string for names that should be treated as placeholders.
 */
export function cleanPartyName(raw: string): string {
  let name = raw.trim();
  if (!name) return "";

  // Strip surrounding brackets or parens.
  if (
    (name.startsWith("[") && name.endsWith("]")) ||
    (name.startsWith("(") && name.endsWith(")")) ||
    (name.startsWith("{") && name.endsWith("}"))
  ) {
    name = name.slice(1, -1).trim();
  }

  // Strip surrounding quotes.
  if (
    (name.startsWith('"') && name.endsWith('"')) ||
    (name.startsWith("'") && name.endsWith("'")) ||
    (name.startsWith("“") && name.endsWith("”"))
  ) {
    name = name.slice(1, -1).trim();
  }

  // Drop template filler words.
  name = name.replace(PLACEHOLDER_FILLER, " ").replace(/\s+/g, " ").trim();

  // Trailing parenthetical role restatement: 'Acme Corp (the "Customer")'.
  name = name
    .replace(/\s*\(\s*(?:the\s+)?["“]?[^)"”]+["”]?\s*\)\s*$/i, "")
    .trim();

  // Trailing jurisdiction / entity descriptor: ", a Delaware corporation".
  name = name.replace(/,\s*an?\s+[^,]+?(?:corporation|company|llc|llp|limited\s+liability\s+(?:company|partnership)|partnership|trust|foundation|association|entity|individual|person)\s*$/i, "").trim();

  // Trailing generic address-y parentheses.
  name = name.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // Trailing punctuation.
  name = name.replace(/[,;:.\s]+$/, "").trim();

  if (looksLikePlaceholder(name)) return "";

  // Intentionally do NOT titleize. Acronyms (KBB, IBM, Y&I) and brand
  // marks (IPass, iPhone, NASDAQ) defy simple casing rules, and the
  // model sees the original contract with correct capitalization — its
  // output is more reliable than any heuristic we could apply here.
  return name;
}

/**
 * Normalize the raw extraction output:
 *  - cleans each party name
 *  - flips isPlaceholder=true when cleaning leaves the name empty
 *  - canonicalizes role labels
 *  - drops parties where both name and role are missing (rare; would
 *    be unusable downstream)
 */
export function normalizeParties(
  raw: Array<{ name: string; role: string; isPlaceholder: boolean }>,
): ExtractedParty[] {
  const out: ExtractedParty[] = [];
  for (const p of raw) {
    const role = normalizeRole(p.role);
    const cleaned = cleanPartyName(p.name);
    const isPlaceholder = cleaned === "";
    if (!cleaned && !role) continue;
    out.push({ name: cleaned, role, isPlaceholder });
  }
  return out;
}
