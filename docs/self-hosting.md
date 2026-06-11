# Self-hosting

This guide takes you from a fresh clone to a working local install, and from
there to a production deployment on Vercel.

## What you need

- [Bun](https://bun.sh) 1.3+
- A hosted [Supabase](https://supabase.com) project (free tier works). The
  app targets hosted Supabase only; the local `supabase start` Docker stack
  is not supported.
- An OpenAI or Anthropic API key for local development. In production, users
  bring their own keys (see "BYOK" below).
- For production email sign-in: a [Resend](https://resend.com) account with a
  verified sending domain. Local dev does not need this.

## Local setup

1. Clone and install:

   ```bash
   git clone https://github.com/zenzen-sol/wargame-oss.git
   cd wargame-oss
   bun install
   ```

2. Run the setup assistant:

   ```bash
   bun run setup
   ```

   It creates the three `.env.local` files from their examples, generates
   the app secrets (writing the must-match pairs to both apps in one step,
   so they cannot drift), prompts you for the Supabase credentials and an
   LLM key, and finishes with a doctor pass that pings your Supabase
   project. It is idempotent: re-running only fills in blanks, and
   `bun run setup --check` runs just the doctor.

3. Apply the schema. Link the repo to your Supabase project, then run the
   one-shot init migration in the Supabase SQL editor:

   ```bash
   bun db:link
   ```

   Open the SQL editor in the Supabase dashboard and run the contents of
   `packages/db/supabase/migrations/*_init.sql`.

4. Sign-in works without an email provider: `DEV_AUTH_BYPASS=1` (the
   default) routes OTPs into a database table instead of email. Navigate
   to `http://localhost:3000/api/dev/sign-in` to get a session.

5. Run it:

   ```bash
   bun dev
   ```

   This starts `apps/saas` and `apps/workflows` together. The ports are
   pinned by `scripts/dev.sh` because `WORKFLOW_TRIGGER_URL` in the saas env
   is the only thing telling saas where to find workflows.

## The three secrets that must match

These values are compared or used across both apps. If any pair disagrees,
the failure is silent: triggers 401 quietly, or stored API keys fail to
decrypt.

| Variable | Where | Why it must match |
|---|---|---|
| `WORKFLOW_AUTH_TOKEN` | saas + workflows | saas presents it; workflows compares it (constant-time) before starting a pipeline |
| `API_KEY_ENCRYPTION_SECRET` | saas + workflows | both apps decrypt the same `user_api_keys` rows |
| `SUPABASE_JWT_SECRET` | saas + Supabase project | saas mints JWTs that Supabase RLS must be able to verify |

Rotating `API_KEY_ENCRYPTION_SECRET` invalidates every stored user key with
no migration path. Store it somewhere safe.

## Run limits

By default there is no cap on issues per run or turns per side per issue;
the setup form's sliders top out at a soft 100. To bound LLM spend on a
shared or public deployment, set both of these (they are enforced
server-side and reshape the sliders):

```
NEXT_PUBLIC_MAX_ISSUES_CAP=3
NEXT_PUBLIC_MAX_TURNS_PER_ISSUE_CAP=10
```

A run makes roughly `issues x turns-per-side x 2` LLM calls, so choose caps
with your wallet in mind.

## BYOK (bring your own key)

In production, each user supplies their own OpenAI or Anthropic API key
during onboarding. Keys are encrypted at rest with AES-256-GCM under
`API_KEY_ENCRYPTION_SECRET` and decrypted only in memory at call time. The
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env vars are a dev-only fallback,
read exclusively when `DEV_AUTH_BYPASS=1` and `NODE_ENV` is not production.

## Deploying to Vercel

The supported production target is Vercel: `apps/saas` and `apps/workflows`
deploy as two separate Vercel projects from the same repo. The workflows app
uses Vercel Workflows for durable execution, so other hosts would need real
porting work.

1. Create two Vercel projects, one rooted at `apps/saas` and one at
   `apps/workflows`.
2. Set the env vars from each app's `.env.example` on the matching project.
   Production additionally needs `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM`
   (verified Resend domain), and `DEV_AUTH_BYPASS` must be unset or `0`.
3. Point `WORKFLOW_TRIGGER_URL` on the saas project at the workflows
   deployment URL plus `/api`.
4. Double-check the three must-match secrets across both projects and both
   environments (Preview and Production).

Observability (Sentry, Langfuse, Axiom) is optional. Leave the keys unset
and the SDKs no-op.

## Troubleshooting

- **Sign-in emails never arrive locally.** Expected; use
  `/api/dev/sign-in` with `DEV_AUTH_BYPASS=1`.
- **Extraction never starts after upload.** `WORKFLOW_AUTH_TOKEN` mismatch
  or `WORKFLOW_TRIGGER_URL` pointing at the wrong place. Check both, then
  check the workflows app's logs.
- **"Could not decrypt API key" or models silently failing.**
  `API_KEY_ENCRYPTION_SECRET` differs between saas and workflows, or it was
  rotated after keys were stored.
- **Database queries return empty for a signed-in user.**
  `SUPABASE_JWT_SECRET` does not match the project's Legacy JWT Secret, so
  RLS sees no identity.
- **`bun run build` fails with "DEV_AUTH_BYPASS is set in production."**
  Working as intended: production builds refuse to include the dev sign-in
  bypass, and `next build` always runs as production. Set
  `DEV_AUTH_BYPASS=0` in `apps/saas/.env.local` before building locally.
  Vercel deploys never hit this because the variable is not set there.
