"use client";

// file-setup + extracting are one continuous beat — "preparing the
// contract." The user clicks Start, the dropzone locks, the same
// call-to-action morphs through "Starting" → "Reading the contract"
// without the surrounding layout changing.

import {
  type FilePhase,
  FilePhaseAction,
} from "@/components/project/file-phase-action";
import { ProviderPicker } from "@/components/project/provider-picker";
import { ProjectFilesSection } from "@/components/project-files-section";
import type { Provider } from "@/lib/actions/onboarding";
import type { Scene } from "@/lib/project-scene";
import type { Tables } from "@/types/database.types";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

// `fade-through` spec from the animate-text catalog — Material-style
// content swap. Slight rise + soft blur on entrance, gentle lift on
// exit. Translated 1:1 from the spec's portable contract; durations
// kept at the spec values (360/260ms) rather than the website's 0.72×
// runtime scaling because a status-text row reads better at full
// pace than as a perceived loop element.
const TRAILING_ENTER_EASE = [0.2, 0, 0, 1] as const;
const TRAILING_EXIT_EASE = [0.4, 0, 1, 1] as const;

type FileRow = Tables<"files">;

export function FilePhaseBody({
  scene,
  starting,
  files,
  onStart,
  availableProviders,
  exiting = false,
}: {
  scene: Extract<Scene, { kind: "file-setup" } | { kind: "extracting" }>;
  starting: boolean;
  files: FileRow[];
  onStart: () => void;
  availableProviders: Provider[];
  /** When true (set by SceneBody during the extracting→setup handoff),
   *  the dropzone runs its two-phase exit (content fade → border
   *  scale-up) and the trailing text and provider picker fade out
   *  alongside the card. The dashed border keeps expanding past the
   *  viewport while the SetupForm fades in beneath. */
  exiting?: boolean;
}) {
  const phase: FilePhase =
    scene.kind === "extracting"
      ? "extracting"
      : starting
        ? "starting"
        : scene.canStart
          ? "ready"
          : "blocked";

  const trailingText =
    phase === "extracting"
      ? "Reading the contract. This takes a moment."
      : phase === "starting"
        ? "Locking the file and starting the agents."
        : phase === "blocked" && scene.kind === "file-setup"
          ? scene.blockReason
          : "";

  const currentProvider = (scene.project.provider as Provider | null) ?? null;

  // True while ProviderPicker has a debounced or in-flight persist.
  // Gates the Start action so the user can't race extraction kick-
  // off against a stale snapshot. The picker itself stays clickable.
  const [providerPersisting, setProviderPersisting] = useState(false);
  // True the instant a user picks a file (pre-SSR-roundtrip). Drops
  // the provider picker immediately so it doesn't flash visible
  // alongside an uploading row.
  const [uploadsPending, setUploadsPending] = useState(false);

  // Picker is only meaningful before any file lands. Once files
  // exist OR uploads are in flight, the provider snapshot is
  // load-bearing — hide the picker entirely.
  const showPicker =
    scene.kind === "file-setup" &&
    !!currentProvider &&
    files.length === 0 &&
    !uploadsPending;
  // ProviderPicker self-gates on `availableProviders.length >= 2`;
  // single-key users never see it. Forward that signal so the
  // empty-state copy + the dashed box's vertical sizing can adapt
  // (no "select below" line, no oversized flex-1 area for a picker
  // that never renders).
  const willShowPicker = showPicker && availableProviders.length >= 2;

  return (
    <div className="flex flex-col h-full mt-12 mx-auto w-full justify-center gap-12">
      <ProjectFilesSection
        project={scene.project}
        files={files}
        disabled={phase !== "ready" && phase !== "blocked"}
        onPendingChange={setUploadsPending}
        exiting={exiting}
        pickerBelow={willShowPicker}
        trailingAction={({ hasPending }) => (
          <FilePhaseAction
            phase={
              (hasPending || providerPersisting) && phase === "ready"
                ? "blocked"
                : phase
            }
            onStart={onStart}
          />
        )}
      />
      <AnimatePresence initial={false}>
        {showPicker && currentProvider && !exiting && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <ProviderPicker
              projectId={scene.project.id}
              currentProvider={currentProvider}
              availableProviders={availableProviders}
              onPendingChange={setProviderPersisting}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/*
        Reserve the line height regardless of content so the layout
        doesn't jump as the message swaps. The text rotates upward:
        outgoing copy lifts and fades out; incoming copy rises from
        below and settles. relative+absolute stacks the two states
        in the same row so the swap reads as one motion, not two.
      */}
      <motion.div
        className="relative min-h-6 text-center text-muted-foreground"
        animate={exiting ? { opacity: 0 } : { opacity: 1 }}
        transition={{ duration: 0.22, ease: "easeIn" }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {trailingText && !exiting && (
            <motion.p
              key={trailingText}
              initial={{
                opacity: 0,
                y: 6,
                scale: 0.99,
                filter: "blur(2px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                filter: "blur(0px)",
                transition: { duration: 0.36, ease: TRAILING_ENTER_EASE },
              }}
              exit={{
                opacity: 0,
                y: -4,
                filter: "blur(0px)",
                transition: { duration: 0.26, ease: TRAILING_EXIT_EASE },
              }}
              className="absolute inset-x-0"
            >
              {trailingText}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
