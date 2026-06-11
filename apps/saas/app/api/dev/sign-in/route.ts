// Dev-only sign-in helper. Runs the email-OTP flow end-to-end
// without firing Resend by reading the OTP back from
// `dev_otp_inbox`, which `auth.ts` writes to when DEV_AUTH_BYPASS=1.
//
// Two surfaces:
//   GET  /api/dev/sign-in?email=…  → does send+verify, 303 to / with
//                                    Set-Cookie. Just navigate to it.
//   POST /api/dev/sign-in { email } → same dance, returns the BA
//                                    response (Set-Cookie header) for
//                                    programmatic use (curl, agents).
//
// Fail-closed: every call rechecks DEV_AUTH_BYPASS and asserts
// NODE_ENV != production. The auth module guards too.
import { auth } from "@/lib/auth";
import { Pool } from "pg";
import { NextResponse } from "next/server";

let pool: Pool | undefined;
function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.BETTER_AUTH_DATABASE_URL;
  if (!url) {
    throw new Error("BETTER_AUTH_DATABASE_URL is not set.");
  }
  pool = new Pool({ connectionString: url });
  return pool;
}

function gateError(): NextResponse | null {
  if (process.env.DEV_AUTH_BYPASS !== "1") {
    return NextResponse.json(
      { error: "DEV_AUTH_BYPASS is not enabled." },
      { status: 403 },
    );
  }
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Dev sign-in is disabled in production." },
      { status: 403 },
    );
  }
  return null;
}

async function runOtpDance(email: string): Promise<Response> {
  const sendResp = await auth.api.sendVerificationOTP({
    body: { email, type: "sign-in" },
    asResponse: true,
  });
  if (!sendResp.ok) {
    const text = await sendResp.text().catch(() => "");
    return NextResponse.json(
      { error: `OTP send failed: ${text || sendResp.status}` },
      { status: 502 },
    );
  }

  const result = await getPool().query<{ otp: string }>(
    'select otp from dev_otp_inbox where email = $1 order by "created_at" desc limit 1',
    [email],
  );
  const row = result.rows[0];
  if (!row) {
    return NextResponse.json(
      { error: "No OTP landed in dev_otp_inbox — is auth.ts wired?" },
      { status: 500 },
    );
  }

  return await auth.api.signInEmailOTP({
    body: { email, otp: row.otp },
    asResponse: true,
  });
}

const DEFAULT_DEV_EMAIL = "dev@local.test";

export async function GET(request: Request) {
  const gate = gateError();
  if (gate) return gate;

  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? DEFAULT_DEV_EMAIL)
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const baResp = await runOtpDance(email);
  if (!baResp.ok) return baResp;

  // Forward Better-Auth's Set-Cookie to a 303 → /
  const redirect = NextResponse.redirect(new URL("/", request.url), 303);
  for (const cookie of baResp.headers.getSetCookie()) {
    redirect.headers.append("Set-Cookie", cookie);
  }
  return redirect;
}

export async function POST(request: Request) {
  const gate = gateError();
  if (gate) return gate;

  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  return await runOtpDance(email);
}
