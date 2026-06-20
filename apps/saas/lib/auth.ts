import { getBetterAuthPool } from "@/lib/better-auth-db";
// Better-Auth instance backed by Postgres (Supabase) via the
// built-in Kysely adapter. Better-Auth manages auth UX (sign-in,
// passkeys, sessions, OTP); a separate JWT bridge in
// @/lib/supabase-jwt.ts mints Supabase-compatible JWTs from
// Better-Auth sessions for use with the supabase-js client.
//
// IDs are uuid so they match `projects.owner_id` and `auth.uid()`.
// Tables live in `public` (Better-Auth defaults) — see the schema
// migration for the full DDL.
import { passkey } from "@better-auth/passkey";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Resend } from "resend";

// Site URL resolution. Falls back to VERCEL_URL on preview deploys
// where NEXT_PUBLIC_SITE_URL isn't scoped (it's Production-only — the
// custom domain), then to localhost for `next build` introspection
// in CI. The hard-fail used to live here at module-eval time, but
// that broke `next build`'s "Collecting page data" pass on previews;
// the runtime check below still catches a genuinely-missing value
// when a request actually reaches Better-Auth.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
  "http://localhost:3000";

const devAuthBypass = process.env.DEV_AUTH_BYPASS === "1";
if (devAuthBypass && process.env.NODE_ENV === "production") {
  throw new Error(
    "DEV_AUTH_BYPASS is set in production. Hard-fail to prevent the " +
      "dev OTP bypass from running against real users.",
  );
}

const pool = getBetterAuthPool();

// Resend client is cheap to construct, but per `server-hoist-static-io`:
// hoisting any I/O-adjacent allocation out of the hot path is the cheap
// win. Lazy so we don't crash module-load when DEV_AUTH_BYPASS is on
// and AUTH_RESEND_KEY is absent.
let cachedResend: Resend | null = null;
function getResend(): Resend {
  if (cachedResend) return cachedResend;
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) {
    throw new Error(
      "AUTH_RESEND_KEY is not set. Set DEV_AUTH_BYPASS=1 for local dev " +
        "or configure Resend for production.",
    );
  }
  cachedResend = new Resend(apiKey);
  return cachedResend;
}

export const authOptions = {
  baseURL: siteUrl,
  // Production trusts only its own site URL. Dev / preview also
  // trusts localhost so the `bun dev` / preview-deploy auth flows
  // work from a developer's machine. Allowing localhost in prod
  // weakens Better-Auth's origin check — anything on the user's
  // machine could make authenticated cross-origin requests.
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? [siteUrl]
      : [siteUrl, "http://localhost:*"],
  database: pool,
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
  // Better-Auth's built-in IP-based rate limiter. We have our own per-
  // user limits on the cost-affecting endpoints (lib/rate-limit.ts);
  // this stays enabled but with a looser budget so it stops obvious
  // attacks (credential stuffing, OTP brute-force) without blocking
  // legit retries. Per-route caps below are tighter where it matters.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 60 * 20,
      // Loosen the email-otp plugin's default (3 req / 60s per IP).
      // Three is too tight when one legit sign-in is two requests
      // (send + verify) and a typo bumps you to four. A real
      // brute-forcer on a 6-digit numeric OTP needs ~1M attempts to
      // succeed at 50% probability; 10/60s is still effectively
      // unbreakable in the 20-minute OTP window.
      rateLimit: { window: 60, max: 10 },
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") return;

        if (devAuthBypass) {
          await pool.query("delete from dev_otp_inbox where email = $1", [
            email,
          ]);
          await pool.query(
            "insert into dev_otp_inbox (email, otp) values ($1, $2)",
            [email, otp],
          );
          return;
        }

        // From address must use a Resend-verified domain. The
        // historical hardcode `onboarding@resend.dev` is Resend's
        // testing-only domain, which only accepts mail to the
        // account owner's address — every other recipient gets 403.
        // AUTH_EMAIL_FROM should be `Display Name <address@domain>`.
        const from = process.env.AUTH_EMAIL_FROM;
        if (!from) {
          throw new Error(
            "AUTH_EMAIL_FROM is not set. Set it to a verified Resend sender (e.g. `Wargame <no-reply@auth.wargame.esq>`).",
          );
        }
        const { error } = await getResend().emails.send({
          from,
          to: [email],
          subject: "Your Wargame sign-in code",
          text: `Your sign-in code is ${otp}\n\nThis code expires in 20 minutes.`,
        });
        if (error) {
          throw new Error(`Resend send failed: ${error.message}`);
        }
      },
    }),
    passkey({
      rpName: "Wargame",
    }),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth(authOptions);

export type Auth = typeof auth;
