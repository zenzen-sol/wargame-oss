"use client";

// Client form for the interest poll. Two multiple-choice questions
// plus an optional comment. Server action `savePollResponse` upserts
// the row; we use a thank-you state instead of redirecting so the
// user can change their answers in place if they want to.

import { Section } from "@/components/setup/section";
import { Button } from "@/components/ui/button";
import { PickRow } from "@/components/ui/pick-row";
import { Textarea } from "@/components/ui/textarea";
import { savePollResponse } from "@/lib/actions/poll";
import type {
  PollResponse,
  PriceBand,
  WantsMoreModels,
  WantsUnlimited,
} from "@/lib/poll-options";
import { useState, type FormEvent } from "react";

const UNLIMITED_OPTIONS: Array<{ value: WantsUnlimited; label: string }> = [
  { value: "yes", label: "Yes. I'd unlock more issues / longer negotiations." },
  { value: "maybe", label: "Maybe. Depends on the cost." },
  { value: "no", label: "No. The current limits are fine for me." },
];

const MORE_MODELS_OPTIONS: Array<{ value: WantsMoreModels; label: string }> = [
  {
    value: "yes",
    label: "Yes. I'd want access to other models or providers.",
  },
  { value: "maybe", label: "Maybe. Depends on which models." },
  {
    value: "no",
    label: "No. The current model lineup is fine for me.",
  },
];

const PRICE_OPTIONS: Array<{ value: PriceBand; label: string }> = [
  { value: "free_only", label: "Only if it's free" },
  { value: "under_20", label: "Less than $20 per project" },
  { value: "20_50", label: "$20–$50 per project" },
  { value: "50_100", label: "$50–$100 per project" },
  { value: "100_250", label: "$100–$250 per project" },
  { value: "over_250", label: "More than $250 per project" },
];

export function PollForm({ initial }: { initial: PollResponse | null }) {
  const [wantsUnlimited, setWantsUnlimited] = useState<WantsUnlimited | null>(
    initial?.wantsUnlimited ?? null,
  );
  const [wantsMoreModels, setWantsMoreModels] =
    useState<WantsMoreModels | null>(initial?.wantsMoreModels ?? null);
  const [priceBand, setPriceBand] = useState<PriceBand | null>(
    initial?.priceBand ?? null,
  );
  const [comment, setComment] = useState<string>(initial?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(
    initial ? Date.now() : null,
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  // The price question is shown only when there's something to price —
  // i.e. the user expressed any interest in one of the upgrades. If
  // both questions are "no", the price band is irrelevant.
  const showPriceQuestion =
    (wantsUnlimited !== null && wantsUnlimited !== "no") ||
    (wantsMoreModels !== null && wantsMoreModels !== "no");
  // Both interest questions must be answered before we accept a
  // submission. The price question is contingent and may legitimately
  // be skipped.
  const canSubmit =
    wantsUnlimited !== null && wantsMoreModels !== null && !submitting;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || !wantsUnlimited || !wantsMoreModels) return;
    setSubmitting(true);
    setErrorMessage("");
    const result = await savePollResponse({
      wantsUnlimited,
      wantsMoreModels,
      priceBand: showPriceQuestion ? priceBand : null,
      comment,
    });
    setSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message ?? "Could not save your response.");
      return;
    }
    setSavedAt(Date.now());
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-12">
      <Section title="Would you like to unlock unlimited issues and turns?">
        <fieldset className="flex flex-col gap-2">
          {UNLIMITED_OPTIONS.map((opt) => (
            <PickRow
              key={opt.value}
              kind="radio"
              name="wants-unlimited"
              value={opt.value}
              checked={wantsUnlimited === opt.value}
              onSelect={() => {
                setWantsUnlimited(opt.value);
                setSavedAt(null);
              }}
            >
              {opt.label}
            </PickRow>
          ))}
        </fieldset>
      </Section>

      <Section title="Would you like access to other models or providers?">
        <fieldset className="flex flex-col gap-2">
          {MORE_MODELS_OPTIONS.map((opt) => (
            <PickRow
              key={opt.value}
              kind="radio"
              name="wants-more-models"
              value={opt.value}
              checked={wantsMoreModels === opt.value}
              onSelect={() => {
                setWantsMoreModels(opt.value);
                setSavedAt(null);
              }}
            >
              {opt.label}
            </PickRow>
          ))}
        </fieldset>
      </Section>

      {showPriceQuestion && (
        <Section title="What would you be willing to pay?">
          <fieldset className="flex flex-col gap-2">
            {PRICE_OPTIONS.map((opt) => (
              <PickRow
                key={opt.value}
                kind="radio"
                name="price-band"
                value={opt.value}
                checked={priceBand === opt.value}
                onSelect={() => {
                  setPriceBand(opt.value);
                  setSavedAt(null);
                }}
              >
                {opt.label}
              </PickRow>
            ))}
          </fieldset>
        </Section>
      )}

      <Section
        title="Anything else?"
        description="Features you want, deal-breakers, or what would make this useful for your workflow."
      >
        <Textarea
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setSavedAt(null);
          }}
          rows={5}
          maxLength={2000}
          placeholder="What would make this more useful for you?"
          className="min-h-32 text-base md:text-base"
        />
      </Section>

      <div className="flex items-center justify-between gap-4">
        <div className="text-muted-foreground text-sm">
          {savedAt && !submitting && !errorMessage
            ? "Thanks — your response is saved."
            : null}
          {errorMessage ? (
            <span className="text-destructive">{errorMessage}</span>
          ) : null}
        </div>
        <Button type="submit" size="lg" disabled={!canSubmit}>
          {submitting
            ? "Saving"
            : savedAt
              ? "Update response"
              : "Submit response"}
        </Button>
      </div>
    </form>
  );
}
