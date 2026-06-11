// Wargame's extraction differs from augustus-omni starting here:
// - augustus groups parties by "side" (one role per side, bilateral
//   structure baked in)
// - wargame uses ONE role PER PARTY, with sides as a user-defined
//   grouping done later in the UI
// So we ask the LLM for a flat list of parties, each with its own
// role. Sides are no concept extraction needs to know about. The
// role guidance has been hardened to anchor on the contract's
// PRIMARY deal type — not on whatever vocabulary appears in the
// confidentiality or supply clauses inside that contract.

import { z } from "zod";

export const extractionSchema = z.object({
  title: z
    .string()
    .describe(
      'Short, descriptive title for the contract or contract bundle (e.g. "Acme Corp NDA", "Omo Corporation SAFE"). Title case. Do NOT include bracketed placeholders or filler words like "INSERT" or "TBD".',
    ),
  parties: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "Legal name of the entity, cleaned. If the contract contains only a templated placeholder (e.g. '[Customer Name]', 'INSERT FULL SUPPLIER NAME', '_____'), return an empty string and set isPlaceholder=true — DO NOT return the bracketed placeholder text verbatim and DO NOT invent a name.",
          ),
        role: z
          .string()
          .describe(
            'The party\'s FUNCTIONAL ROLE in this deal — what they DO, not what one section\'s defined term calls them. Singular, title case. Read the headline transaction: a License Agreement gives "Licensor"/"Licensee" even when its confidentiality clause uses "Disclosing Party"/"Receiving Party"; an MSA gives "Customer"/"Supplier" even when a confidentiality section labels them differently. Pick the role that describes the party\'s core function in the contract\'s primary purpose.',
          ),
        isPlaceholder: z
          .boolean()
          .describe(
            "True when the contract gave only a templated placeholder for this party and no real legal name was present. False when you extracted a real entity name.",
          ),
      }),
    )
    .describe(
      "Every party named in the contract, one entry per entity. Most contracts name two parties; multi-party contracts (joint ventures, three-way deals, deals with guarantors or co-borrowers) can have more. Two parties on the same side of the deal still get separate entries with the same role.",
    ),
});

export type RawExtraction = z.infer<typeof extractionSchema>;

export const EXTRACTION_RULES = `RULES — read every line, they are not optional.

TITLE
- Return the contract type ONLY, in title case. Examples: "Master License Agreement", "Mutual NDA", "SAFE", "Asset Purchase Agreement", "Employment Offer Letter".
- Do NOT include party names, role pairs ("— Customer / Supplier"), or jurisdictions in the title.
- NEVER include bracketed placeholders, 'INSERT', 'FULL', 'TBD', 'TO BE NAMED', or underscores.

PARTIES — this is the most important part, get it right.

Identify EVERY party named in the contract. One entry per entity. No grouping by "side" — output is a flat list. The user assigns sides later.

ROLE SELECTION (the most common failure mode is here):

Role is the party's FUNCTIONAL purpose in this deal — what they DO. It is NOT whatever defined term a single clause uses for them. Most contracts contain confidentiality, indemnity, governing-law, and dispute clauses; those clauses introduce their own labels ("Disclosing Party", "Indemnifying Party") that apply only inside that clause. **Those are not roles.** Roles describe the deal as a whole.

To find the role, ask: "what is this contract fundamentally about?" The headline answer drives the role pair.

Common deal types and their natural role pairs:
- License Agreement → Licensor (grants rights) / Licensee (receives rights)
- Master Services Agreement / SOW → Customer (buys services) / Supplier or Vendor or Consultant (provides services)
- Subscription / SaaS Agreement → Customer / Provider (or Vendor)
- Mutual / Unilateral NDA — confidentiality IS the deal here → Disclosing Party / Receiving Party
- SAFE, equity round, term sheet → Investor / Company
- Employment Agreement / Offer Letter → Employer / Employee
- Independent Contractor Agreement → Client / Contractor
- Loan / Credit Agreement → Lender / Borrower
- Lease / Sublease → Landlord / Tenant (or Sublessor / Sublessee)
- Asset / Stock Purchase Agreement → Buyer or Purchaser / Seller
- Distribution Agreement → Manufacturer or Supplier / Distributor
- Reseller Agreement → Provider / Reseller

Use the contract's actual vocabulary when it differs sensibly — if a license agreement consistently calls parties "Owner" and "User", use those instead of forcing "Licensor"/"Licensee".

Always title case, singular ("Licensor" not "licensors"). Never reuse a clause-only label as a party's role.

MULTI-PARTY CONTRACTS:
- A bilateral contract has 2 parties. Output 2 entries.
- A contract with multiple entities sharing a role (e.g. two co-licensees, two co-borrowers) gets 2 entries with the same role.
- A contract with a guarantor, co-signer, or third-party beneficiary gets that entity as its own entry with its own role (e.g. "Guarantor", "Co-Borrower").
- Do not invent extra parties. Only emit what the contract actually names.

ENTITY NAMES (per party):
- If the contract names a REAL legal entity (e.g. "Acme Corporation, a Delaware corporation"), return that entity name, cleaned:
  - Drop trailing parenthetical role restatements: 'Acme Corp (the "Customer")' → 'Acme Corp'.
  - Drop jurisdiction / type descriptors when they bloat the name: 'Acme Corporation, a Delaware corporation' → 'Acme Corporation'.
  - Preserve meaningful suffixes: Inc., LLC, Ltd., GmbH, S.A., etc.
  - **Preserve capitalization exactly as the contract presents it.** Do NOT normalize the case. Acronyms (KBB, IBM, Y&I, FINRA), brand marks (IPass, iPhone, NASDAQ), and mixed-case names keep their original form. If the preamble is in ALL CAPS but the rest of the contract uses mixed case for the same entity, use the mixed-case version.
- If the contract contains ONLY a placeholder ('[Customer Name]', 'INSERT FULL SUPPLIER NAME', '____', 'TBD', 'To be named'), return name='' and isPlaceholder=true. DO NOT return the bracketed placeholder text. DO NOT invent a name. DO NOT restate the role as the name.`;

/**
 * Build the full prompt for the extraction call. `filesBlock` is the
 * concatenation of `[FILE n: name]\n<content>` blocks built by the
 * caller (so file fetching stays in the action layer, not in this
 * pure module).
 */
export function extractionPrompt(filesBlock: string): string {
  return `You are reading one or more contract files that together form a single deal. Extract a bundle-level title and the parties.

${EXTRACTION_RULES}

Files:

${filesBlock}`;
}
