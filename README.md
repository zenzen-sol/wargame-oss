# Wargame

Wargame runs simulated negotiations on your business contracts. Two teams of AI agents—one friendly, and one adversarial—review your contract and produce an issues list. The agents negotiate the issues point-by-point while you watch their internal reasoning and conversation in real time.

This is a tool for pressure-testing positions, spotting potential issues, and game-planning negotiations. Nothing it produces is legal advice.

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

## Deploy to Vercel

Production deploys use two Vercel projects from this repo: deploy
`apps/workflows` first, then deploy `apps/saas` with
`WORKFLOW_TRIGGER_URL` pointed at the workflows deployment plus `/api`.
The buttons below bootstrap those projects, but you still need the
[self-hosting guide](docs/self-hosting.md#deploying-to-vercel) for the
Supabase setup and shared secrets.

| Project | Deploy |
|---|---|
| Workflows (`apps/workflows`) | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fzenzen-sol%2Fwargame-oss%2Ftree%2Fmain%2Fapps%2Fworkflows&project-name=wargame-workflows&repository-name=wargame-oss&env=NEXT_PUBLIC_SUPABASE_URL%2CSUPABASE_SECRET_KEY%2CWORKFLOW_AUTH_TOKEN%2CAPI_KEY_ENCRYPTION_SECRET&envDescription=Follow+the+Wargame+self-hosting+guide+to+create+Supabase+resources+and+shared+secrets+before+deploying.&envLink=https%3A%2F%2Fgithub.com%2Fzenzen-sol%2Fwargame-oss%2Fblob%2Fmain%2Fdocs%2Fself-hosting.md%23deploying-to-vercel) |
| App (`apps/saas`) | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fzenzen-sol%2Fwargame-oss%2Ftree%2Fmain%2Fapps%2Fsaas&project-name=wargame-app&repository-name=wargame-oss&env=BETTER_AUTH_DATABASE_URL%2CBETTER_AUTH_SECRET%2CNEXT_PUBLIC_SITE_URL%2CAUTH_RESEND_KEY%2CAUTH_EMAIL_FROM%2CNEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY%2CSUPABASE_SECRET_KEY%2CSUPABASE_JWT_SECRET%2CWORKFLOW_TRIGGER_URL%2CWORKFLOW_AUTH_TOKEN%2CAPI_KEY_ENCRYPTION_SECRET&envDescription=Follow+the+Wargame+self-hosting+guide+to+create+Supabase+resources+and+shared+secrets+before+deploying.&envLink=https%3A%2F%2Fgithub.com%2Fzenzen-sol%2Fwargame-oss%2Fblob%2Fmain%2Fdocs%2Fself-hosting.md%23deploying-to-vercel) |

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
