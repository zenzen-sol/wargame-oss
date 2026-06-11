// Per-user project cap. Enforced in three layers:
//   1. New Project button reads this and pre-disables when at cap
//      (no surprise error after a click).
//   2. createProject server action throws if the count is at or
//      above the cap (handles race + direct action invocation).
//   3. DB trigger enforce_project_limit backstops the same number
//      so a malicious client hitting PostgREST directly still can't
//      bypass.
//
// When billing / tiers land, the cap should move out of a single
// constant and into a per-user lookup (e.g. user.plan). The DB
// trigger probably wants to either go away or be raised to a high
// sanity-only ceiling at that point.
const DEFAULT_MAX = 10;
const envMax = Number(process.env.PROJECTS_PER_USER_MAX);
export const PROJECTS_PER_USER_MAX =
  Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX;
