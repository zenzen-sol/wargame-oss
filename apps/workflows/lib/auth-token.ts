// Shared trigger-token validation for the two saas → workflows
// entry routes (start-extraction, start-conversion).
//
// Why a helper:
//   - constant-time compare so a network-local attacker can't recover
//     bytes via timing. Practically infeasible across Vercel's
//     network jitter, but the fix costs nothing and the primitive
//     (shared secret in POST body) deserves it.
//   - one place to add replay protection (nonce + timestamp window)
//     if/when we get there.
//   - one place for the misconfigured-server 503 vs unauthorized 401
//     distinction so both routes behave identically.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Returns `null` if the token is valid; an error response otherwise.
 * Callers should `return` the response directly.
 */
export function validateAuthToken(authToken: unknown): Response | null {
  const expected = process.env.WORKFLOW_AUTH_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "WORKFLOW_AUTH_TOKEN not set on the workflows app." },
      { status: 503 },
    );
  }
  if (typeof authToken !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const a = Buffer.from(authToken, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch — guard explicitly.
  // We still pad to equal length for a constant-time path on
  // length-mismatch attempts, then return 401 either way.
  if (a.length !== b.length) {
    // Touch a fixed-length compare so this branch isn't faster
    // than the equal-length branch.
    timingSafeEqual(b, b);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
