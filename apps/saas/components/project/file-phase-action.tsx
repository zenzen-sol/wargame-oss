"use client";

// One button-shaped element across the entire file phase. The shape
// never disappears; the label morphs and the leading icon swaps
// (PlayIcon ↔ pulsing dot) so the user's eye stays anchored.

import { Button } from "@/components/ui/button";
import { PlayIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";

export type FilePhase = "ready" | "blocked" | "starting" | "extracting";

const PHASE_LABEL: Record<FilePhase, ReactNode | string> = {
  ready: "Start",
  blocked: "Start",
  starting: <Shimmer>Starting</Shimmer>,
  extracting: <Shimmer>Analyzing Contract</Shimmer>,
};

export function FilePhaseAction({
  phase,
  onStart,
}: {
  phase: FilePhase;
  onStart: () => void;
}) {
  const isWorking = phase === "starting" || phase === "extracting";
  const disabled = phase !== "ready";
  return (
    <Button
      onClick={phase === "ready" ? onStart : undefined}
      disabled={disabled}
      size="lg"
    >
      {!isWorking && <PlayIcon weight="fill" className="size-4" />}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={phase}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          {PHASE_LABEL[phase]}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}
