-- ===========================================================================
-- wargame-esq baseline schema. Single migration that creates every table,
-- enum, index, and RLS policy.
--
-- Auth: Better-Auth (passkeys + email-OTP). Better-Auth manages its own
-- tables — `user`, `session`, `account`, `verification`, `passkey` —
-- defined at the bottom of this file. They live in `public` so
-- Better-Auth's Postgres adapter (which expects unqualified names) can
-- find them.
--
-- RLS bridge: when the app issues a Supabase query, it mints a JWT signed
-- with the project's Legacy JWT Secret (env: SUPABASE_JWT_SECRET) carrying
-- `sub: <user.id>` + `role: "authenticated"`. PostgREST validates and
-- populates `request.jwt.claims`, so `auth.uid()` returns the Better-Auth
-- user id and RLS policies on owner-scoped tables work as written.
--
-- The secret key bypasses RLS for trusted server-side ops (chat route
-- persistence, workflow extraction writes, Storage admin).
-- ===========================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto" with schema public;

-- Enums ---------------------------------------------------------------------
create type project_status as enum (
  'draft',
  'extracting',
  'ready_for_interview',
  'interviewing',
  'reviewing',
  'negotiating',
  'complete',
  'complete_with_impasses',
  'failed',
  'cancelling',
  'cancelled'
);

create type conversion_status as enum ('pending', 'done', 'failed');

create type message_status as enum ('streaming', 'complete', 'failed');

create type issue_severity as enum ('low', 'medium', 'high', 'critical');

create type issue_status as enum (
  'open',
  'in_negotiation',
  'agreed',
  'escalated',
  'impasse',
  'deferred',
  'unresolved'
);

create type agent_kind as enum ('red', 'blue', 'system');

create type message_role as enum (
  'review', 'argument', 'resolution', 'interview', 'thinking'
);

create type draft_ownership as enum ('ours', 'theirs', 'neither');

create type interview_question_key as enum (
  'user_side_details',
  'counterparty_details'
);

create type output_kind as enum ('redline', 'memo', 'transcript');

-- Tables --------------------------------------------------------------------

create table projects (
  id uuid primary key default gen_random_uuid(),
  -- owner_id is the Better-Auth user id (UUID). FK to public.user is
  -- added at the bottom of this file once that table exists.
  owner_id uuid not null,
  name text not null,
  status project_status not null default 'draft',
  slug text unique,
  completed_at timestamptz,
  archived_at timestamptz,
  failure_message text,
  draft_ownership draft_ownership,
  cancel_requested_at timestamptz,
  run_usage jsonb,
  -- Tuning knobs set during the setup form. Bounded by the
  -- agent's own caps (3 issues, 8 turns/issue) until we raise
  -- those limits.
  max_issues integer not null default 3,
  max_turns_per_issue integer not null default 8,
  -- Single-run-at-a-time lock. The chat route atomically claims a
  -- project by setting this to now() where the previous value was
  -- NULL or older than the stale threshold (6 minutes, over the
  -- 300s Vercel maxDuration). Without it, two concurrent POSTs
  -- race persistReviewIssues' read-then-write and double the
  -- per-project issue cap. Released in the route's finally/onFinish
  -- paths; auto-recovers from crashed runs after the TTL.
  run_started_at timestamptz,
  -- LLM provider snapshot taken at project creation so an in-flight
  -- run uses a consistent provider even if the user later changes
  -- their default. Pulled from user_api_keys when the LLM call needs
  -- the actual key. Nullable for legacy rows from before BYOK.
  provider text check (provider in ('openai', 'anthropic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_idx on projects (owner_id);
create index projects_run_started_at_idx
  on projects (run_started_at)
  where run_started_at is not null;

-- Per-owner sequential display ID (`WG-1`, `WG-2`, …). Decoupled from
-- the URL `slug` (random base32) so cross-tenant enumeration via the
-- display number is impossible: User A's WG-1 and User B's WG-1 are
-- different projects with different opaque URL slugs.
alter table projects add column display_id text;
create unique index projects_owner_display_id_idx
  on projects (owner_id, display_id);

create or replace function next_user_project_display_id(p_owner uuid)
  returns text
  language sql
  security definer
  set search_path = public
as $$
  select 'WG-' || (
    coalesce(
      (select max(cast(substring(display_id from 4) as integer))
       from projects
       where owner_id = p_owner and display_id like 'WG-%'),
      0
    ) + 1
  )::text;
$$;

grant execute on function next_user_project_display_id(uuid) to authenticated;
create index projects_owner_status_idx on projects (owner_id, status);

create table files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_key text not null,
  name text not null,
  mime_type text not null,
  byte_size bigint not null,
  markdown_content text,
  conversion_status conversion_status not null default 'pending',
  conversion_error text,
  created_at timestamptz not null default now()
);
create index files_project_idx on files (project_id);

create table project_parties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  side integer not null,
  name text not null,
  role text,
  is_placeholder boolean not null default false,
  -- NULL until the user confirms parties via the setup form. Readers
  -- must use `is_user_side is true` / `is false` and treat NULL as
  -- "side not yet assigned" rather than implicitly counterparty.
  is_user_side boolean,
  created_at timestamptz not null default now()
);
create index project_parties_project_idx on project_parties (project_id);

create table interview_answers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  question_key interview_question_key not null,
  answer text not null,
  updated_at timestamptz not null default now(),
  unique (project_id, question_key)
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  raised_by agent_kind not null check (raised_by in ('blue', 'red')),
  title text not null,
  summary text not null,
  severity issue_severity not null,
  status issue_status not null default 'open',
  resolution jsonb,
  created_at timestamptz not null default now()
);
create index issues_project_idx on issues (project_id);
create index issues_project_status_idx on issues (project_id, status);

create table messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  issue_id uuid references issues (id) on delete cascade,
  agent agent_kind not null,
  role message_role not null,
  content text not null default '',
  reasoning text,
  status message_status not null default 'complete',
  stream_id text,
  completed_at timestamptz,
  proposal_tool_call jsonb,
  created_at timestamptz not null default now()
);
create index messages_project_idx on messages (project_id);
create index messages_project_issue_idx on messages (project_id, issue_id);

create table outputs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind output_kind not null,
  storage_key text not null,
  created_at timestamptz not null default now(),
  unique (project_id, kind)
);

-- Working-draft state per source file. Every turn that emits OOXML
-- edits writes a `proposal` version against the latest accepted (or
-- upload) baseline. When an issue resolves agreed, the latest proposal
-- row is "promoted" by writing a new `accepted` row that points at it
-- as parent. All other resolution kinds leave the baseline put.
--
-- We keep proposal rows even when an issue ends without promotion so
-- the negotiation history is inspectable; only `upload` + `accepted`
-- rows form the canonical baseline chain.
create type project_document_version_source as enum (
  'upload',
  'proposal',
  'accepted'
);

create table project_document_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  file_id uuid not null references files (id) on delete cascade,
  source project_document_version_source not null,
  storage_key text not null,
  -- Monotonic per file_id across every source (upload starts at 1;
  -- subsequent rows increment regardless of source). Assigned in
  -- application code (see lib/working-draft.ts) so we can prove the
  -- order without a per-file sequence.
  version_number integer not null,
  parent_version_id uuid references project_document_versions (id),
  -- Set when the row was written by a chat turn. References the
  -- assistant message that issued propose_clause_edit (for proposal
  -- rows) or accept_proposal (for accepted rows).
  message_id uuid references messages (id) on delete set null,
  issue_id uuid references issues (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (file_id, version_number)
);

create index project_document_versions_file_idx
  on project_document_versions (file_id, created_at desc);
create index project_document_versions_project_idx
  on project_document_versions (project_id, created_at desc);
create index project_document_versions_baseline_idx
  on project_document_versions (file_id, source, created_at desc);

-- updated_at triggers -------------------------------------------------------
-- Keep the column honest without making every UPDATE statement set it
-- by hand. PostgREST + the JS SDK don't help us here; this is the
-- standard Postgres trigger pattern.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

create trigger interview_answers_updated_at
  before update on interview_answers
  for each row execute function set_updated_at();

-- Row-Level Security --------------------------------------------------------
-- Browser-side queries use the publishable key, which authenticates as the
-- `authenticated` role (or `anon` for unauth). RLS is the actual security
-- boundary — every owner-scoped table has policies for select/insert/update/
-- delete that key off auth.uid().
--
-- Server-side trusted writes (chat route's onFinish, workflow extraction)
-- use the secret key, which bypasses RLS entirely. Those code paths run
-- their own ownership checks before the write.

alter table projects enable row level security;
alter table files enable row level security;
alter table project_parties enable row level security;
alter table interview_answers enable row level security;
alter table issues enable row level security;
alter table messages enable row level security;
alter table outputs enable row level security;
alter table project_document_versions enable row level security;

grant select, insert, update, delete on table
  projects,
  files,
  project_parties,
  interview_answers,
  issues,
  messages,
  outputs,
  project_document_versions
to authenticated;

-- projects: owner-scoped end-to-end.
create policy projects_owner_select on projects
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy projects_owner_insert on projects
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy projects_owner_update on projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy projects_owner_delete on projects
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Helper: is the caller the owner of the project this child row belongs to?
-- Marked SECURITY DEFINER so the function can read projects.owner_id even
-- when the caller's RLS would otherwise hide it.
create or replace function public.user_owns_project(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from projects
    where projects.id = p_id
      and projects.owner_id = (select auth.uid())
  );
$$;
grant execute on function public.user_owns_project(uuid) to authenticated;

-- Project-child tables: gate via the helper.
create policy files_owner_select on files
  for select to authenticated using (public.user_owns_project(project_id));
create policy files_owner_insert on files
  for insert to authenticated with check (public.user_owns_project(project_id));
create policy files_owner_update on files
  for update to authenticated
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));
create policy files_owner_delete on files
  for delete to authenticated using (public.user_owns_project(project_id));

create policy project_parties_owner_select on project_parties
  for select to authenticated using (public.user_owns_project(project_id));
create policy project_parties_owner_insert on project_parties
  for insert to authenticated with check (public.user_owns_project(project_id));
create policy project_parties_owner_update on project_parties
  for update to authenticated
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));
create policy project_parties_owner_delete on project_parties
  for delete to authenticated using (public.user_owns_project(project_id));

create policy interview_answers_owner_select on interview_answers
  for select to authenticated using (public.user_owns_project(project_id));
create policy interview_answers_owner_insert on interview_answers
  for insert to authenticated with check (public.user_owns_project(project_id));
create policy interview_answers_owner_update on interview_answers
  for update to authenticated
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));
create policy interview_answers_owner_delete on interview_answers
  for delete to authenticated using (public.user_owns_project(project_id));

create policy issues_owner_select on issues
  for select to authenticated using (public.user_owns_project(project_id));
create policy issues_owner_insert on issues
  for insert to authenticated with check (public.user_owns_project(project_id));
create policy issues_owner_update on issues
  for update to authenticated
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));
create policy issues_owner_delete on issues
  for delete to authenticated using (public.user_owns_project(project_id));

create policy messages_owner_select on messages
  for select to authenticated using (public.user_owns_project(project_id));
create policy messages_owner_insert on messages
  for insert to authenticated with check (public.user_owns_project(project_id));
create policy messages_owner_update on messages
  for update to authenticated
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));
create policy messages_owner_delete on messages
  for delete to authenticated using (public.user_owns_project(project_id));

create policy outputs_owner_select on outputs
  for select to authenticated using (public.user_owns_project(project_id));
create policy outputs_owner_insert on outputs
  for insert to authenticated with check (public.user_owns_project(project_id));
create policy outputs_owner_update on outputs
  for update to authenticated
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));
create policy outputs_owner_delete on outputs
  for delete to authenticated using (public.user_owns_project(project_id));

create policy project_document_versions_owner_select on project_document_versions
  for select to authenticated using (public.user_owns_project(project_id));
create policy project_document_versions_owner_insert on project_document_versions
  for insert to authenticated with check (public.user_owns_project(project_id));
create policy project_document_versions_owner_update on project_document_versions
  for update to authenticated
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));
create policy project_document_versions_owner_delete on project_document_versions
  for delete to authenticated using (public.user_owns_project(project_id));

-- Storage buckets + policies ------------------------------------------------
-- The browser uploads to a private bucket via signed URLs minted server-side.
-- The bucket itself is created by hand in the dashboard (or via the CLI);
-- the policies below gate per-user access to objects when read by the
-- authenticated role.
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 1048576)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

create policy "project-files: owner can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "project-files: owner can insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "project-files: owner can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Realtime publication ------------------------------------------------------
-- Browser subscribes via supabase-js Realtime, authenticated through the
-- Better-Auth → JWT bridge (see lib/use-project-realtime.ts). Realtime
-- only emits changes for tables in the `supabase_realtime` publication;
-- add every project-scoped table the UI watches. RLS still gates which
-- rows actually reach the client.
alter publication supabase_realtime add table
  projects, files, project_parties, interview_answers, issues, messages,
  outputs;



-- ===========================================================================
-- Better-Auth tables.
--
-- Owned by Better-Auth's Postgres adapter (Kysely under the hood). Table
-- names are unquoted (case-insensitive in Postgres → folded to lower);
-- COLUMN names are camelCase, double-quoted, because Better-Auth core
-- emits camelCase regardless of the adapter's `casing` option (which
-- only affects table names). Verified in `@better-auth/core/db/get-tables.mjs`.
--
-- IDs are uuid (Better-Auth normally uses cuid2; we override with
-- `advanced.generateId: () => crypto.randomUUID()` so `user.id` matches
-- the uuid type our `projects.owner_id` and `auth.uid()` use).
--
-- RLS is OFF on these tables. Better-Auth connects via its own
-- Postgres pool (not through PostgREST), and the `authenticated` role
-- never queries them directly. The application boundary is Better-Auth
-- itself — these tables aren't user-facing.
-- ===========================================================================

create table "user" (
  id uuid primary key,
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  -- One-shot legal-disclaimer ack. Null = not yet acknowledged;
  -- (auth)/layout.tsx redirects to /welcome/disclaimer until set.
  -- After the user clicks Accept on the modal, set to now().
  disclaimer_acknowledged_at timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table session (
  id uuid primary key,
  "userId" uuid not null references "user" (id) on delete cascade,
  token text not null unique,
  "expiresAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table account (
  id uuid primary key,
  "userId" uuid not null references "user" (id) on delete cascade,
  "accountId" text not null,
  "providerId" text not null,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table verification (
  id uuid primary key,
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- @better-auth/passkey plugin schema. Field names match the plugin's
-- camelCase emit exactly. Note `credentialID` (capital ID) — that's the
-- plugin's actual field name.
create table passkey (
  id uuid primary key,
  name text,
  "publicKey" text not null,
  "userId" uuid not null references "user" (id) on delete cascade,
  "credentialID" text not null,
  counter integer not null,
  "deviceType" text not null,
  "backedUp" boolean not null,
  transports text,
  "createdAt" timestamptz not null default now(),
  -- Authenticator Attestation GUID. Required by @better-auth/passkey
  -- v1.6.x — the verify-register handler writes it after a successful
  -- WebAuthn ceremony. Nullable per the plugin's own schema; the
  -- column simply has to exist or the INSERT silently fails (the OS
  -- saves the credential, the DB does not).
  aaguid text
);

-- Now that `user` exists, FK projects.owner_id to it.
alter table projects
  add constraint projects_owner_id_fkey
  foreign key (owner_id) references "user" (id) on delete cascade;

-- Dev-only OTP mailbox for the email-OTP bypass. When DEV_AUTH_BYPASS=1,
-- sendVerificationOTP writes here instead of firing Resend, and
-- /api/dev/sign-in reads it back. Fail-closed at runtime: every read/
-- write checks DEV_AUTH_BYPASS, and the auth module asserts the flag
-- must NOT be set when NODE_ENV=production.
create table dev_otp_inbox (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  otp text not null,
  created_at timestamptz not null default now()
);
create index dev_otp_inbox_email_idx on dev_otp_inbox (email);

-- ─────────────────────────────────────────────────────────────────────
-- Auth-table RLS lockdown
-- ─────────────────────────────────────────────────────────────────────
--
-- Better-Auth manages these six tables via its own pg adapter
-- connecting as `postgres` through BETTER_AUTH_DATABASE_URL. That
-- role is BYPASSRLS, so Better-Auth keeps reading/writing freely.
--
-- But PostgREST also auto-exposes every `public` schema table to
-- `anon` + `authenticated`, and Supabase grants those roles all DML
-- privileges on `public` tables by default. Without RLS that means
-- anyone holding the publishable key (which ships in every client
-- bundle) can SELECT user emails, session ids, OTPs, etc. Enabling
-- RLS with no policies blocks every non-BYPASSRLS role outright.
--
-- App code never reads these tables via supabase-js; the session
-- cookie is the source of truth and Better-Auth handles writes.
-- Zero policies is correct.

alter table "user" enable row level security;
alter table session enable row level security;
alter table account enable row level security;
alter table verification enable row level security;
alter table passkey enable row level security;
alter table dev_otp_inbox enable row level security;

-- ─────────────────────────────────────────────────────────────────────
-- BYOK — per-user encrypted API keys
-- ─────────────────────────────────────────────────────────────────────
--
-- One row per (user, provider). The encrypted_key + iv + auth_tag
-- triple is AES-256-GCM ciphertext + nonce + GCM auth tag, all hex-
-- encoded. Plaintext lives only briefly in process memory when
-- making LLM calls.
--
-- API_KEY_ENCRYPTION_SECRET (32-byte hex) on the saas + workflows
-- apps is the master key. Rotating it invalidates every row — no
-- migration pathway, users re-paste their keys.

create table user_api_keys (
  user_id uuid not null references "user" (id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic')),
  encrypted_key text not null,
  iv text not null,
  auth_tag text not null,
  last_validated_at timestamptz,
  -- The default provider for *new* project creation. Exactly one row
  -- per user may have this true; enforced by the partial unique
  -- index below. App code (lib/actions/onboarding.ts) keeps the
  -- invariant on save/delete: the first saved key becomes default;
  -- deleting the default reassigns to a surviving key.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
-- At-most-one default per user. A partial unique index does the
-- right thing: rows with is_default=false don't participate, so
-- multiple non-default keys are fine; only one true row is allowed.
create unique index user_api_keys_one_default_per_user
  on user_api_keys (user_id) where is_default;

alter table user_api_keys enable row level security;

grant select, insert, update, delete on table user_api_keys to authenticated;

create policy user_api_keys_own_select on user_api_keys
  for select using ((select auth.uid()) = user_id);
create policy user_api_keys_own_insert on user_api_keys
  for insert with check ((select auth.uid()) = user_id);
create policy user_api_keys_own_update on user_api_keys
  for update using ((select auth.uid()) = user_id);
create policy user_api_keys_own_delete on user_api_keys
  for delete using ((select auth.uid()) = user_id);

create trigger user_api_keys_updated_at
  before update on user_api_keys
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Poll responses
-- ─────────────────────────────────────────────────────────────────────
--
-- Lightweight interest poll. One row per user, upserted on each save
-- so a user can refine their answers. The "Why these limits?" link
-- in the setup form points here; the page collects two multiple-
-- choice answers plus an optional comment.

create table poll_responses (
  user_id uuid primary key references "user" (id) on delete cascade,
  -- "Would you like to unlock unlimited issues and turns per project?"
  wants_unlimited text not null check (
    wants_unlimited in ('yes', 'maybe', 'no')
  ),
  -- "Would you like access to other models or providers?"
  -- Nullable so rows written before this column existed remain valid;
  -- new submissions are required to set it at the app layer.
  wants_more_models text check (
    wants_more_models in ('yes', 'maybe', 'no')
  ),
  -- "What would you be willing to pay per project to unlock that?"
  -- Nullable because users who said "no" can skip it.
  price_band text check (
    price_band in (
      'free_only',
      'under_20',
      '20_50',
      '50_100',
      '100_250',
      'over_250'
    )
  ),
  -- Optional free-text feedback. Capped at 2000 chars by the server
  -- action; no DB-side limit so a paste of slightly more isn't fatal.
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table poll_responses enable row level security;

grant select, insert, update, delete on table poll_responses to authenticated;

create policy poll_responses_own_select on poll_responses
  for select using ((select auth.uid()) = user_id);
create policy poll_responses_own_insert on poll_responses
  for insert with check ((select auth.uid()) = user_id);
create policy poll_responses_own_update on poll_responses
  for update using ((select auth.uid()) = user_id);

create trigger poll_responses_updated_at
  before update on poll_responses
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Cost-protection guards
-- ─────────────────────────────────────────────────────────────────────
--
-- Three pieces:
--   1. rate_limit_events table + check_rate_limit function for per-
--      user burst+daily caps on cost-affecting endpoints (chat,
--      extraction, conversion).
--   2. enforce_project_limit trigger so projects-per-user is capped
--      at the DB layer even if the server action is bypassed.
--   3. Storage bucket file size limit (set via the storage API; not
--      reproducible via plain SQL — see notes below).
--
-- App code in apps/saas/lib/rate-limit.ts + the createProject action
-- + the submitSetup action enforce nicer error messages on top of
-- these, but everything below is the trusted boundary.

create table rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user" (id) on delete cascade,
  bucket text not null,
  occurred_at timestamptz not null default now()
);
create index rate_limit_events_user_bucket_time_idx
  on rate_limit_events (user_id, bucket, occurred_at desc);
-- RLS on with no policies = denied for all user-facing access. The
-- SECURITY DEFINER function below is the only path that reads/writes.
alter table rate_limit_events enable row level security;

create or replace function check_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_burst_window_secs integer,
  p_burst_max integer,
  p_long_window_secs integer,
  p_long_max integer
) returns table (
  allowed boolean,
  burst_count integer,
  long_count integer,
  retry_after_secs integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_burst_count integer;
  v_long_count integer;
  v_retry_secs integer := 0;
  v_oldest_burst timestamptz;
  v_oldest_long timestamptz;
begin
  select count(*) into v_burst_count
    from rate_limit_events
    where user_id = p_user_id
      and bucket = p_bucket
      and occurred_at > v_now - make_interval(secs => p_burst_window_secs);

  select count(*) into v_long_count
    from rate_limit_events
    where user_id = p_user_id
      and bucket = p_bucket
      and occurred_at > v_now - make_interval(secs => p_long_window_secs);

  if v_burst_count >= p_burst_max then
    select min(occurred_at) into v_oldest_burst
      from rate_limit_events
      where user_id = p_user_id
        and bucket = p_bucket
        and occurred_at > v_now - make_interval(secs => p_burst_window_secs);
    v_retry_secs := greatest(
      ceil(extract(epoch from
        (v_oldest_burst + make_interval(secs => p_burst_window_secs)) - v_now
      ))::integer,
      1
    );
    return query select false, v_burst_count, v_long_count, v_retry_secs;
    return;
  end if;

  if v_long_count >= p_long_max then
    select min(occurred_at) into v_oldest_long
      from rate_limit_events
      where user_id = p_user_id
        and bucket = p_bucket
        and occurred_at > v_now - make_interval(secs => p_long_window_secs);
    v_retry_secs := greatest(
      ceil(extract(epoch from
        (v_oldest_long + make_interval(secs => p_long_window_secs)) - v_now
      ))::integer,
      1
    );
    return query select false, v_burst_count, v_long_count, v_retry_secs;
    return;
  end if;

  insert into rate_limit_events (user_id, bucket, occurred_at)
    values (p_user_id, p_bucket, v_now);

  -- Opportunistic cleanup. Keeps each (user, bucket) pair to at most
  -- a day of history without a separate cron job.
  delete from rate_limit_events
    where user_id = p_user_id
      and bucket = p_bucket
      and occurred_at < v_now - interval '1 day';

  return query select true, v_burst_count + 1, v_long_count + 1, 0;
end;
$$;

grant execute on function check_rate_limit(uuid, text, integer, integer, integer, integer)
  to service_role;

-- Per-user project sanity ceiling (1000). The real cap lives in
-- apps/saas/lib/project-limits.ts (env-overridable, defaults to 10)
-- and is checked in the createProject server action. This trigger
-- is just a high backstop so a direct PostgREST POST can't run away.
create or replace function enforce_project_limit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from projects where owner_id = NEW.owner_id;
  if v_count >= 1000 then
    raise exception 'Project limit reached: 1000 projects per user'
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

create trigger projects_owner_limit_trigger
  before insert on projects
  for each row execute function enforce_project_limit();

-- Storage bucket file_size_limit on `project-files` (1 MB) is set
-- in the bucket insert above; hosted projects created before this
-- was inlined had it applied via the Storage API.
