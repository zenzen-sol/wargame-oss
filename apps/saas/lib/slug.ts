// Crockford-style base32 alphabet — no I/L/O/U so slugs are easy to
// read aloud and copy. 30^8 ≈ 6.5e11 unique slugs. Used for URLs so
// cross-tenant enumeration is infeasible; per-user display ids
// (`WG-N`) come from the `next_user_project_display_id` RPC.
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
const SLUG_LENGTH = 8;

export function generateSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  }
  return out;
}

export function untitledProjectName(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `Untitled project — ${formatter.format(now)}`;
}
