"use client";

// One centered form. Captures party-side selection, draft
// ownership, free-text context for each side, and two tuning
// knobs. Submits everything at once via `submitSetup`, which
// flips the project straight to `reviewing`.
//
// Deliberately small. No useEffect, no useRef, no useMemo —
// just useState for form fields and derived values in render.
// The fancier canonical primitives are skipped here in favour
// of native HTML controls so the form is predictable and the
// render path stays flat. We can swap to FF Slider / RadioGroup
// later once the schema + persistence are wired.

import { EditPartiesDialog } from "@/components/edit-parties-dialog";
import { PartyRow } from "@/components/setup/party-row";
import { Section } from "@/components/setup/section";
import { Button } from "@/components/ui/button";
import { PickRow } from "@/components/ui/pick-row";
import { SliderComfortable } from "@/components/ui/slider";
import { submitSetup } from "@/lib/actions/interview";
import {
  MAX_ISSUES_CAP,
  MAX_TURNS_PER_ISSUE_CAP,
  MIN_ISSUES,
  MIN_TURNS_PER_ISSUE,
  clampToCap,
} from "@/lib/limits";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database.types";
import { PlayIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

type Project = Tables<"projects">;
type Party = Tables<"project_parties">;
type AnswerRow = Tables<"interview_answers">;

type DraftOwnership = "ours" | "theirs" | "neither";

const OWNERSHIP_OPTIONS: Array<{ value: DraftOwnership; label: string }> = [
  { value: "neither", label: "Neither (template, form, or both contributed)" },
  { value: "theirs", label: "Theirs" },
  { value: "ours", label: "Ours" },
];

const DEFAULT_DRAFT_OWNERSHIP: DraftOwnership = "neither";

// Initial knob values, clamped so a demo deployment with tight caps
// never seeds a value the server action would reject.
const DEFAULT_MAX_ISSUES = clampToCap(3, MIN_ISSUES, MAX_ISSUES_CAP);
const DEFAULT_MAX_TURNS_PER_ISSUE = clampToCap(
  8,
  MIN_TURNS_PER_ISSUE,
  MAX_TURNS_PER_ISSUE_CAP,
);

// Nonlinear stop scale for the tuning sliders: fine-grained 1–10 by
// ones, 10–100 by tens, beyond 100 by hundreds, always ending exactly
// at the cap. Uncapped deployments get a soft UI top of 100 — the
// server accepts anything, but the scale needs an end; setting the
// cap env var moves it.
function sliderStops(cap: number | null): number[] {
  const top = cap ?? 100;
  const stops: number[] = [];
  for (let v = 1; v <= Math.min(top, 10); v += 1) stops.push(v);
  for (let v = 20; v <= Math.min(top, 100); v += 10) stops.push(v);
  for (let v = 200; v <= top; v += 100) stops.push(v);
  if (stops[stops.length - 1] !== top) stops.push(top);
  return stops;
}

// SliderComfortable interpolates linearly over [min, max]; drive it
// in index space so each stop gets one evenly-spaced pip and the
// displayed value maps through the stop scale.
function SteppedSlider({
  label,
  stops,
  value,
  onChange,
  className,
}: {
  label: string;
  stops: number[];
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  // Nearest-stop fallback keeps a value that's off the grid (stale
  // form state after a cap change) from pinning the slider to 1.
  const index = stops.reduce(
    (best, stop, i) =>
      Math.abs(stop - value) < Math.abs((stops[best] ?? 1) - value) ? i : best,
    0,
  );
  return (
    <SliderComfortable
      label={label}
      value={index}
      min={0}
      max={stops.length - 1}
      step={1}
      onChange={(i) => onChange(stops[i] ?? 1)}
      formatValue={(i) => String(stops[i] ?? "")}
      getAriaValueText={(i) => String(stops[i] ?? "")}
      variant="pips"
      className={className}
    />
  );
}

export function SetupForm({
  project,
  parties,
  answers,
  fileCount,
}: {
  project: Project;
  parties: Party[];
  answers: AnswerRow[];
  fileCount: number;
}) {
  // Form state. Each useState's initial value is read from the
  // server once; subsequent renders don't re-seed (no useEffect
  // syncing, no prop-derived state stored in state). If `parties`
  // changes upstream (Edit dialog), invalid IDs in the selection
  // are filtered at submit time.
  const [userPartyIds, setUserPartyIds] = useState<Set<string>>(
    () =>
      new Set(parties.filter((p) => p.is_user_side === true).map((p) => p.id)),
  );
  const [draftOwnership, setDraftOwnership] = useState<DraftOwnership>(
    (project.draft_ownership as DraftOwnership | null) ??
      DEFAULT_DRAFT_OWNERSHIP,
  );
  const [userSideDetails, setUserSideDetails] = useState<string>(
    answers.find((a) => a.question_key === "user_side_details")?.answer || "",
  );
  const [counterpartyDetails, setCounterpartyDetails] = useState<string>(
    answers.find((a) => a.question_key === "counterparty_details")?.answer ??
      "",
  );
  const [maxIssues, setMaxIssues] = useState<number>(DEFAULT_MAX_ISSUES);
  const [maxTurnsPerIssue, setMaxTurnsPerIssue] = useState<number>(
    DEFAULT_MAX_TURNS_PER_ISSUE,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  // Derived in render — no memoization, all primitives.
  const userCount = userPartyIds.size;
  const counterCount = parties.length - userCount;
  const canSubmit =
    parties.length >= 2 && userCount > 0 && counterCount > 0 && !submitting;
  const docNoun = fileCount === 1 ? "this document" : "these documents";

  function toggleParty(id: string) {
    setUserPartyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      const validIds = new Set(parties.map((p) => p.id));
      const submittedIds = [...userPartyIds].filter((id) => validIds.has(id));
      await submitSetup({
        projectId: project.id,
        userPartyIds: submittedIds,
        draftOwnership,
        userSideDetails,
        counterpartyDetails,
        maxIssues,
        maxTurnsPerIssue,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not start the review.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col py-12 text-base"
    >
      <div className="grid grid-cols-3 gap-24 w-full">
        <div className="col-span-1 space-y-12">
          <Section
            title="About your side."
            description="Any instructions, goals, bottom lines, preferences, etc., that will help your agent steer the negotiation toward success for your side."
          >
            <textarea
              value={userSideDetails}
              placeholder="Optional"
              onChange={(e) => setUserSideDetails(e.target.value)}
              rows={15}
              className={cn(
                "resize-y rounded-lg border border-border bg-background p-3 leading-relaxed outline-none transition-colors",
                "placeholder:text-muted-foreground/50",
                "focus:border-ring focus:ring-3 focus:ring-ring/50",
              )}
            />
            <div className="text-sm text-muted-foreground">
              Examples: We want a reasonable, market-standard outcome. No
              onerous obligations. No terms that unduly limit our flexibility.
            </div>
          </Section>
        </div>

        <div className="col-span-1 space-y-12">
          <Section title="Who do you represent?">
            {parties.length === 0 ? (
              <p className="text-muted-foreground">
                No parties yet. Use Edit party information to add one.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {parties.map((p) => (
                  <PartyRow
                    key={p.id}
                    party={p}
                    index={parties.indexOf(p)}
                    picked={userPartyIds.has(p.id)}
                    onToggle={() => toggleParty(p.id)}
                  />
                ))}
              </ul>
            )}

            <Button
              type="button"
              variant="link"
              onClick={() => setEditOpen(true)}
              className="ml-auto"
            >
              Edit party information
            </Button>
          </Section>

          <Section title={`Who provided ${docNoun}?`}>
            <fieldset className="flex flex-col gap-2">
              {OWNERSHIP_OPTIONS.map((opt) => (
                <PickRow
                  key={opt.value}
                  kind="radio"
                  name="draft-ownership"
                  value={opt.value}
                  checked={draftOwnership === opt.value}
                  onSelect={() => setDraftOwnership(opt.value)}
                >
                  {opt.label}
                </PickRow>
              ))}
            </fieldset>
          </Section>

          <Section title="Negotation settings.">
            <div className="space-y-2">
              <SteppedSlider
                label="Max. issues"
                stops={sliderStops(MAX_ISSUES_CAP)}
                value={maxIssues}
                onChange={setMaxIssues}
                // Match the checkbox/radio row height so the controls
                // line up vertically.
                className="h-10"
              />
              <SteppedSlider
                label="Max. turns per side per issue"
                stops={sliderStops(MAX_TURNS_PER_ISSUE_CAP)}
                value={maxTurnsPerIssue}
                onChange={setMaxTurnsPerIssue}
                className="h-10"
              />
            </div>
            {(MAX_ISSUES_CAP !== null || MAX_TURNS_PER_ISSUE_CAP !== null) && (
              <Link
                href="/poll"
                className="self-start text-muted-foreground text-sm underline underline-offset-4 decoration-dotted hover:text-foreground"
              >
                Why these limits?
              </Link>
            )}
          </Section>

          <Button
            type="submit"
            disabled={!canSubmit}
            size="lg"
            className="h-14 w-full text-base"
          >
            <PlayIcon weight="fill" className="size-4" />
            {submitting ? "Starting" : "Start"}
          </Button>
          {errorMessage && (
            <p className="text-right text-destructive">{errorMessage}</p>
          )}
        </div>

        <div className="col-span-1 space-y-12">
          <Section
            title="About their side."
            description="Any details about the counterparty that will help their agent advocate in a realistic manner for their side."
          >
            <textarea
              value={counterpartyDetails}
              placeholder="Optional"
              onChange={(e) => setCounterpartyDetails(e.target.value)}
              rows={15}
              className={cn(
                "resize-y rounded-lg border border-border bg-background p-3 leading-relaxed outline-none transition-colors",
                "placeholder:text-muted-foreground/50",
                "focus:border-ring focus:ring-3 focus:ring-ring/50",
              )}
            />
            <div className="text-sm text-muted-foreground">
              Examples: Their GC fights every proposed change. They're
              aggressively pursuing revenue they can book this month.
            </div>
          </Section>
        </div>
      </div>

      <EditPartiesDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        parties={parties}
        projectId={project.id}
      />
    </form>
  );
}
