# Wargame

Wargame the negotiation before you have it. Upload a contract, tell the app
which party you are, and watch two AI agents negotiate the document issue by
issue: one advocating your side's interests, one playing a realistic
counterparty. Each issue resolves, deadlocks, or hits its turn cap, and the
run compiles the agreed language into a tracked-changes redline you can open
in Word.

This is a tool for pressure-testing positions, not a lawyer. Nothing it
produces is legal advice.

## How it works

1. Upload a `.docx`. A durable pipeline converts it and extracts the
   parties and negotiable issues.
2. Pick your side, add free-text guidance for each side's agent, and set
   the run size (max issues, max turns per side per issue).
3. Two agents negotiate each issue turn by turn while you watch the
   transcript stream. A resolution detector decides when a position has
   actually been agreed.
4. Agreed clause language compiles into a redlined `.docx` with real
   tracked changes.

Users bring their own LLM API key (OpenAI or Anthropic), stored encrypted
and used only at call time.

## Repository layout

| Path | What it is |
|---|---|
| `apps/saas` | The product: Next.js App Router, owns the agent chat loop and all state transitions |
| `apps/workflows` | Durable pipelines (docx conversion, issue extraction) on Vercel Workflows |
| `packages/agents` | Prompts, negotiation tools, model catalog, supervisor loop, BYOK crypto |
| `packages/extraction` | docx parsing and contract-term extraction |
| `packages/docx-redlines` | Tracked-changes engine for docx XML |
| `packages/db` | Supabase project root: schema, RLS policies, auth config |

State lives in Supabase (Postgres, Storage, Realtime). Auth is Better-Auth
with an HS256 JWT bridge into Supabase row-level security. See
[docs/architecture.md](docs/architecture.md) for the full picture and the
reasoning behind the service split.

## Getting started

[docs/self-hosting.md](docs/self-hosting.md) is the step-by-step guide.
The short version:

```bash
curl -fsSL https://bun.com/install | bash  # if you do not have Bun yet
bun --version
bun install
bun run setup   # starts local Supabase, wires env, asks to open the app
```

Use `bun run setup --launch` to skip the prompt and open the app, or
`bun run setup --no-launch` to set up without starting it.

`bun dev` runs the product app and the workflows app together. Local
development needs Docker (the setup assistant runs Supabase locally and
wires everything up). It does not need a Supabase account, an email
provider, or any observability accounts. Users add an OpenAI or Anthropic
API key in the app during onboarding.

## Run limits

Self-hosted installs run uncapped by default. To bound LLM spend on a
shared deployment, set `NEXT_PUBLIC_MAX_ISSUES_CAP` and
`NEXT_PUBLIC_MAX_TURNS_PER_ISSUE_CAP`; they are enforced server-side and
the setup form's sliders reshape to match. The hosted demo runs with
`3 / 10`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `bun typecheck` and `bun lint`
gate every PR.

## License

[MIT](LICENSE)
