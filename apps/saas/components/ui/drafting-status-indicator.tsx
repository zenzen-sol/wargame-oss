"use client";

// Shimmering phase indicator for the end-of-run Drafter block.
// Mirrors ThinkingIndicator's rotating-word animation, but the
// label changes when the *actual* phase progresses (drafting →
// compiling) rather than on a timer. Use this instead of a bare
// "Streaming · 0:XX" chip when the work is opaque to the user
// (token stream is contract markdown, not human-meaningful prose).

import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

export type DrafterPhase = "drafting" | "compiling";

const PHASE_LABEL: Record<DrafterPhase, string> = {
  drafting: "Preparing redline",
  compiling: "Compiling redline",
};

// Longest label among the union — used as an invisible sizer so the
// indicator's width doesn't jitter when the phase changes.
const LONGEST_LABEL = Object.values(PHASE_LABEL).reduce((a, b) =>
  a.length >= b.length ? a : b,
);

export function DraftingStatusIndicator({
  phase,
  className,
}: {
  phase: DrafterPhase;
  className?: string;
}) {
  const label = PHASE_LABEL[phase];
  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: role="status" on a
      // div is the right ARIA for a polite live indicator.
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2", className)}
    >
      <span
        className="grid justify-items-start overflow-clip text-left leading-none"
        style={{ fontVariationSettings: fontWeights.medium }}
      >
        <span
          className="col-start-1 row-start-1 invisible shimmer-text whitespace-nowrap"
          aria-hidden="true"
        >
          {LONGEST_LABEL}
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={phase}
            className="col-start-1 row-start-1 shimmer-text whitespace-nowrap text-left"
            initial={{ y: "100%", opacity: 0 }}
            animate={{
              y: 0,
              opacity: 1,
              transition: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
            }}
            exit={{
              y: "-100%",
              opacity: 0,
              transition: { duration: 0.16, ease: [0.4, 0, 0.2, 1] },
            }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}
