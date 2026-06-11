// Temporary probe endpoint to verify Sentry is wired up correctly.
// GET this URL in prod — it throws on purpose. The thrown error
// should appear in Sentry within ~30s with a source-mapped stack
// pointing to this file. Remove the route after verification.
//
// Curl:
//   curl https://app.wargame.esq/api/sentry-probe

export const dynamic = "force-dynamic";

export async function GET() {
  throw new Error(
    "[sentry-probe] Verification throw — if you see this in Sentry, the saas pipe works.",
  );
}
