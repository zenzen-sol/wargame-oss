"use client";

import type { DraftViewerSourceData } from "@/lib/queries/draft-viewer";
import { ExtractionFailedBody } from "@/components/project/extraction-failed-body";
import { FilePhaseBody } from "@/components/project/file-phase-body";
import { TranscriptShell } from "@/components/project/transcript-shell";
import { SetupForm } from "@/components/setup/setup-form";
import type { Provider } from "@/lib/actions/onboarding";
import type { Scene } from "@/lib/project-scene";
import type { Tables } from "@/types/database.types";
import { StopIcon } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { type MutableRefObject, useEffect, useRef, useState } from "react";

type Party = Tables<"project_parties">;
type FileRow = Tables<"files">;
type AnswerRow = Tables<"interview_answers">;
type MessageRow = Tables<"messages">;
type IssueRow = Tables<"issues">;

export interface SceneBodyProps {
  scene: Scene;
  files: FileRow[];
  parties: Party[];
  answers: AnswerRow[];
  messages: MessageRow[];
  issues: IssueRow[];
  starting: boolean;
  retrying: boolean;
  onStart: () => void;
  onRetryExtraction: () => void;
  chatStopRef: MutableRefObject<(() => void) | null>;
  onOpenIssue: (issueId: string) => void;
  draftSources: DraftViewerSourceData[];
  draftProposalsByMessageId: Record<string, DraftViewerSourceData>;
  availableProviders: Provider[];
}

// Total duration of the extracting→setup handoff. Three serial beats:
//   • 0–230ms     content fades (card, picker, trailing text)
//   • 230–750ms   dashed border scales beyond the viewport + fades
//   • 780–1140ms  SetupForm fades in on the cleared stage
// The form fade waits for the zoom to fully clear — overlapping
// them made the zoom read as a fade-out of the form's backdrop
// rather than a stage-clearing beat. Tiny 30ms gap between border
// gone and form starting is intentional: the eye registers the
// empty viewport for a beat before the new content arrives.
const HANDOFF_MS = 1180;
const FORM_FADE_DELAY_S = 0.78;
const FORM_FADE_DURATION_S = 0.36;

export function SceneBody(props: SceneBodyProps) {
  const { scene } = props;

  // Cache the most recent `extracting` scene so we can keep
  // rendering FilePhaseBody during the handoff after scene.kind has
  // already flipped to "setup" upstream. Without this cache we'd
  // have no Scene object to feed FilePhaseBody (which requires
  // file-setup | extracting).
  const extractingSceneRef = useRef<Extract<
    Scene,
    { kind: "extracting" }
  > | null>(null);
  if (scene.kind === "extracting") {
    extractingSceneRef.current = scene;
  }

  const prevKindRef = useRef(scene.kind);
  const [handoff, setHandoff] = useState(false);
  useEffect(() => {
    const prevKind = prevKindRef.current;
    prevKindRef.current = scene.kind;
    if (prevKind === "extracting" && scene.kind === "setup") {
      setHandoff(true);
      const t = setTimeout(() => setHandoff(false), HANDOFF_MS);
      // Cleanup also clears the flag — if scene.kind changes again
      // mid-handoff (e.g. extraction-failed flipping back), we'd
      // otherwise leave the file phase rendered indefinitely with
      // exiting=true. Resetting here gets us back to the switch.
      return () => {
        clearTimeout(t);
        setHandoff(false);
      };
    }
  }, [scene.kind]);

  // Handoff overrides scene-switch rendering: keep FilePhaseBody on
  // screen with `exiting` so the dropzone runs its choreographed
  // exit (content fade → border expand). SetupForm renders beneath
  // it with a delayed opacity fade so the form is already arriving
  // by the time the dashed border clears the viewport.
  if (handoff && extractingSceneRef.current) {
    return (
      <div className="relative h-full">
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: FORM_FADE_DURATION_S,
            delay: FORM_FADE_DELAY_S,
            ease: "easeOut",
          }}
        >
          <SetupForm
            project={extractingSceneRef.current.project}
            parties={props.parties}
            answers={props.answers}
            fileCount={props.files.length}
          />
        </motion.div>
        <div className="absolute inset-0">
          <FilePhaseBody
            scene={extractingSceneRef.current}
            starting={props.starting}
            files={props.files}
            onStart={props.onStart}
            availableProviders={props.availableProviders}
            exiting
          />
        </div>
      </div>
    );
  }

  switch (scene.kind) {
    case "file-setup":
    case "extracting":
      return (
        <FilePhaseBody
          scene={scene}
          starting={props.starting}
          files={props.files}
          onStart={props.onStart}
          availableProviders={props.availableProviders}
        />
      );
    case "extraction-failed":
      return (
        <ExtractionFailedBody
          scene={scene}
          retrying={props.retrying}
          files={props.files}
          onRetryExtraction={props.onRetryExtraction}
        />
      );
    case "setup":
      return (
        <SetupForm
          project={scene.project}
          parties={props.parties}
          answers={props.answers}
          fileCount={props.files.length}
        />
      );
    case "live":
    case "live-failed":
    case "completed":
      return (
        <TranscriptShell
          scene={scene}
          parties={props.parties}
          messages={props.messages}
          issues={props.issues}
          chatStopRef={props.chatStopRef}
          onOpenIssue={props.onOpenIssue}
          draftSources={props.draftSources}
          draftProposalsByMessageId={props.draftProposalsByMessageId}
        />
      );
    case "cancelled":
      if (scene.hasTranscript) {
        return (
          <TranscriptShell
            scene={scene}
            parties={props.parties}
            messages={props.messages}
            issues={props.issues}
            chatStopRef={props.chatStopRef}
            onOpenIssue={props.onOpenIssue}
            draftSources={props.draftSources}
            draftProposalsByMessageId={props.draftProposalsByMessageId}
          />
        );
      }
      return (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4">
          <StopIcon
            weight="duotone"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">Run cancelled.</p>
            <p className="text-muted-foreground">
              No agent turns completed before the stop. You can archive this
              project from the menu and start a new one.
            </p>
          </div>
        </div>
      );
  }
}
