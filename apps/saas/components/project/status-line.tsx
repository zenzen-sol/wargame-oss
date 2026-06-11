"use client";

import { cn } from "@/lib/utils";

export type PartTone = "muted" | "blue" | "red";
export type StatusPart = string | { text: string; tone?: PartTone };

const PART_TONE_CLASS: Record<PartTone, string> = {
  muted: "text-muted-foreground",
  blue: "text-team-blue",
  red: "text-team-red",
};

const TONE_BG: Record<"active" | "success" | "warning" | "error", string> = {
  active: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

const TONE_TEXT: Record<"active" | "success" | "warning" | "error", string> = {
  active: "text-blue-500",
  success: "text-green-500",
  warning: "text-amber-500",
  error: "text-red-500",
};

export function StatusLine({
  tone,
  pulse,
  noDot,
  heading,
  headingForeground,
  subheading,
  parts,
  onPartsClick,
}: {
  tone: "active" | "success" | "warning" | "error";
  pulse?: boolean;
  /** Suppress the leading colour dot. Useful for neutral terminal
   *  states ("Completed") that shouldn't read as a tone signal. */
  noDot?: boolean;
  heading: string;
  headingForeground?: boolean;
  /** Stable secondary text shown after the heading (e.g. the current
   *  issue title during a live run). Truncates at 42ch so a long
   *  title doesn't push the rest of the line off-screen. */
  subheading?: string;
  parts?: StatusPart[];
  /** When provided, the parts cluster + heading become a button that
   *  opens the issues sheet. Status indicator without parts is still
   *  clickable so the user can reach the sheet during reviewing /
   *  cancelled scenes that don't carry per-issue counts. */
  onPartsClick?: () => void;
}) {
  // `pulse` swaps the leading dot for a shimmer treatment on the
  // heading itself. The dot is kept for non-active tones (success /
  // warning / error) where a static colour disk is the right read,
  // unless explicitly suppressed via `noDot`.
  const dot = pulse || noDot ? null : (
    <span className="relative inline-flex size-2 shrink-0">
      <span
        className={`relative inline-flex size-2 rounded-full ${TONE_BG[tone]}`}
      />
    </span>
  );
  // `shimmer-text` (defined in globals.css) is a pure-CSS shimmer:
  // a moving linear-gradient painted through `background-clip: text`.
  // No motion / no hydration handoff — what SSR renders is what the
  // client paints, which avoids the brief "blue then shimmer" flash
  // we got with the JS-driven Shimmer component.
  const headingTypography = "min-w-0 truncate font-medium";
  const headingNode = pulse ? (
    <span className={cn(headingTypography, "shimmer-text")}>{heading}</span>
  ) : (
    <span
      className={cn(
        headingTypography,
        headingForeground ? "text-foreground" : TONE_TEXT[tone],
      )}
    >
      {heading}
    </span>
  );
  const subheadingNode = subheading ? (
    <span
      className="inline-flex min-w-0 items-center gap-2"
      title={subheading}
    >
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="max-w-[42ch] truncate text-foreground">
        {subheading}
      </span>
    </span>
  ) : null;
  const partsNode =
    parts && parts.length > 0 ? (
      <span
        className={cn(
          "flex shrink-0 items-center gap-2 transition-colors",
          // Only when the parts are part of a clickable trigger does
          // the hover-color flip apply. Plain (non-clickable) parts
          // stay in their tone class so they don't pretend to be
          // interactive.
          onPartsClick &&
            "group-hover/status:text-accent group-focus-visible/status:text-accent",
        )}
      >
        {parts.map((raw) => {
          const part: { text: string; tone: PartTone } =
            typeof raw === "string"
              ? { text: raw, tone: "muted" }
              : { text: raw.text, tone: raw.tone ?? "muted" };
          return (
            <span key={part.text} className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "text-muted-foreground transition-colors",
                  onPartsClick &&
                    "group-hover/status:text-accent group-focus-visible/status:text-accent",
                )}
              >
                ·
              </span>
              <span
                className={cn(
                  PART_TONE_CLASS[part.tone],
                  "transition-colors",
                  onPartsClick &&
                    "group-hover/status:text-accent group-focus-visible/status:text-accent",
                )}
              >
                {part.text}
              </span>
            </span>
          );
        })}
      </span>
    ) : null;

  if (onPartsClick) {
    return (
      <button
        type="button"
        onClick={onPartsClick}
        className="group/status flex min-w-0 items-center gap-2 text-left focus:outline-none"
        title="Show issues"
      >
        {dot}
        {headingNode}
        {subheadingNode}
        {partsNode}
      </button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {dot}
      {headingNode}
      {subheadingNode}
      {partsNode}
    </div>
  );
}
