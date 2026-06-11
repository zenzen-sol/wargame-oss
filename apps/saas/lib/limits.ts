// Deployment-level caps on cost-affecting run parameters. The hosted
// demo sets both env vars to bound LLM spend; self-hosted installs
// leave them unset and run uncapped. NEXT_PUBLIC_ because the setup
// form needs the same values the server action clamps with — Next.js
// inlines them into both bundles, so the UI range and the trusted
// boundary can't drift apart.
//
// Total LLM call count per run is bounded by
// ~ maxIssues × maxTurnsPerIssue × 2 (two sides). The demo's
// 3 × 10 × 2 = 60 turns max.

function parseCap(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const MAX_ISSUES_CAP = parseCap(process.env.NEXT_PUBLIC_MAX_ISSUES_CAP);
export const MAX_TURNS_PER_ISSUE_CAP = parseCap(
  process.env.NEXT_PUBLIC_MAX_TURNS_PER_ISSUE_CAP,
);

export const MIN_ISSUES = 1;
export const MIN_TURNS_PER_ISSUE = 1;

// Clamp a client-supplied value to [min, cap]. A null cap means
// uncapped: only the floor applies.
export function clampToCap(
  value: number,
  min: number,
  cap: number | null,
): number {
  if (!Number.isFinite(value)) return min;
  const floored = Math.max(min, Math.floor(value));
  return cap === null ? floored : Math.min(cap, floored);
}
