// Temporary probe endpoint to verify Sentry is wired up correctly
// on the workflows app. GET throws on purpose. Remove after
// verification.
//
// Curl:
//   curl https://wargame-esq-workflows.vercel.app/api/sentry-probe

export const dynamic = "force-dynamic";

export async function GET() {
  throw new Error(
    "[sentry-probe] Verification throw — if you see this in Sentry, the workflows pipe works.",
  );
}
