import { PollForm } from "@/components/poll/poll-form";
import { AppChrome } from "@/components/shell/app-chrome";
import { getPollResponse } from "@/lib/actions/poll";

// Interest poll. Reached from the "Why these limits?" link on the
// setup form and the "Why these models?" link on the API-keys form.
// Three multiple-choice questions plus an optional comment; one row
// per user, upserted on save so users can revise.
//
// Server-rendered so we can preload the user's existing response
// (if any) and skip the client-side fetch flicker.
export default async function PollPage() {
  const existing = await getPollResponse();

  return (
    <>
      <AppChrome breadcrumbs={[{ label: "Feedback" }]} />
      {/* Scroll container is the full-width wrapper so the scrollbar
          sits at the viewport edge rather than inside the centered
          column. Other (auth) pages put overflow on `main` itself,
          which is fine when the column is wide enough that the
          inset scrollbar isn't visually distracting; the poll's
          narrower 2xl column made it read as a misalignment. */}
      <div className="flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-12 px-6 py-12 lg:px-8">
        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-base">Help shape Wargame.</h1>
          <div className="flex flex-col gap-3 text-muted-foreground leading-snug">
            <p className="text-pretty">
              Wargame is a proof of concept. The caps on issues and turns per
              negotiation, and the narrow set of models behind the scenes, both
              keep operating costs predictable while we learn what's worth
              building toward a more robust, commercially viable version.
            </p>
            <p className="text-pretty">
              A few quick questions would help us understand whether there's
              demand for a paid tier that loosens those constraints, and what
              that tier should look like. Your answers are private and only
              used to shape the product.
            </p>
          </div>
        </div>

          <PollForm initial={existing} />
        </main>
      </div>
    </>
  );
}
