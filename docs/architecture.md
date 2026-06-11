# Architecture

Two product services plus one storage backend. Each does one thing.

```
browser ──▶ apps/saas ──HTTP trigger──▶ apps/workflows
               │                            │
               └────────▶ Supabase ◀────────┘
                  (Postgres + Storage + Realtime)
```

## Supabase: state, auth tables, blobs

- Postgres holds all persistent data (`projects`, `files`, `issues`,
  `messages`, `outputs`, `user_api_keys`).
- Storage holds `.docx` uploads and generated outputs.
- Realtime pushes row-change events that drive cache revalidation in the
  saas app. There is no polling anywhere.
- Supabase never initiates cross-service calls and never makes LLM calls.
  It is a database with row-level security, not an orchestrator.

Three access paths:

1. **Browser** via `supabase-js` with a per-request HS256 JWT minted by
   `apps/saas/lib/supabase-jwt.ts` from the Better-Auth session. RLS
   policies evaluate `auth.uid()` against that JWT.
2. **Server (trusted writes)** via the admin client using
   `SUPABASE_SECRET_KEY`, which bypasses RLS. Used by chat-route
   persistence, workflow steps, and Storage administration, always after
   ownership has been verified.
3. **Better-Auth's Postgres adapter** via `BETTER_AUTH_DATABASE_URL`. Its
   role has BYPASSRLS; the auth tables have RLS enabled with no policies,
   which locks them away from PostgREST entirely.

## apps/saas: orchestrator and agent loop

The Next.js App Router app users sign into. Server actions translate user
intent into RLS-scoped Supabase writes and state transitions. The chat
route (`app/api/projects/[id]/chat/route.ts`) runs the negotiation agent
loop in-process, streaming for the duration of one request. Anything that
must outlive a request is handed to the workflows app over HTTP.

Auth is Better-Auth (email OTP, passkeys) bridged into Supabase RLS via the
HS256 JWT mint above. `DEV_AUTH_BYPASS=1` enables a local-only sign-in
shortcut that stores OTPs in a database table; it is double-gated and
refuses to run in production.

## apps/workflows: durable executor

A Vercel Workflows app exposing thin POST routes that start durable
pipelines:

- **Conversion**: `.docx` to markdown via mammoth.
- **Extraction**: LLM-driven contract metadata extraction, durable across
  restarts via the Workflows event log.

It accepts work only from the saas app: every trigger carries
`WORKFLOW_AUTH_TOKEN`, compared in constant time. Database access goes
through the admin client only; by the time work arrives here, authorization
already happened in saas.

## Why this split

- **State owner is not the orchestrator.** Supabase owns rows; saas decides
  which transitions happen and when to enlist workflows.
- **In-process for short, durable for long.** The agent loop fits inside
  one request window. Conversion and extraction do not, and need resume
  semantics.
- **No tunnels in development.** Both apps run locally and reach each other
  over localhost; the same topology maps onto two Vercel projects in
  production.

## Shared packages

- `packages/agents`: prompts, tools, the model catalog, supervisor loop,
  and the BYOK crypto. Consumed by both apps.
- `packages/extraction`: docx parsing and the extraction schema.
- `packages/docx-redlines`: tracked-changes manipulation of docx XML.
- `packages/db`: the Supabase project root (schema, RLS policies, auth
  config, email templates). Schema lives in a single init migration; see
  `docs/self-hosting.md`.
