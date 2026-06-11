# Contributing

Thanks for your interest. This project is young and the surface area is
deliberately small, so contributions are easiest to land when they are
scoped and discussed first.

## Before you start

- For anything beyond a small fix, open an issue describing what you want
  to change and why before writing code.
- Check `docs/architecture.md` for the service boundaries. PRs that blur
  them (state writes from workflows, orchestration from the database,
  polling where Realtime should push) will be asked to restructure.

## Development setup

Follow `docs/self-hosting.md`. You will need your own Supabase project and
an OpenAI or Anthropic key; local dev does not need Resend or any
observability accounts.

## Ground rules

- **TypeScript, strict.** `bun typecheck` must pass.
- **Biome** for lint and formatting: `bun lint` and `bun format`.
- **No polling.** Data flows are SSR plus server actions, with Supabase
  Realtime pushing row-change events for revalidation.
- **Schema changes** go into the single init migration in
  `packages/db/supabase/migrations/`; do not add incremental migration
  files.
- **Security boundaries.** Server actions are public POST endpoints; treat
  every input as untrusted. RLS is the default; the admin client is for
  trusted writes after ownership is verified, never a convenience.

## Pull requests

- Keep them small and focused; one concern per PR.
- Describe how you verified the change. UI changes should be checked in a
  real browser, not just compiled.
- `bun typecheck` and `bun lint` must both pass.
