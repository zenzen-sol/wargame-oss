"use client";

import { Button } from "@/components/ui/button";
import { retryLastTurn, skipCurrentIssue } from "@/lib/actions/projects";
import {
  ArrowCounterClockwiseIcon,
  SkipForwardIcon,
} from "@phosphor-icons/react";
import { useTransition } from "react";

export function IssueRunControls({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  function handleSkip() {
    if (
      !confirm(
        "Skip this issue? It will be marked deferred and the agents will move on to the next one.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await skipCurrentIssue({ projectId, reason: "Skipped by user." });
      } catch (e) {
        console.error("[issues] skip failed", e);
      }
    });
  }

  function handleRetry() {
    if (
      !confirm(
        "Drop the last turn and re-argue it? This will spend tokens to re-run the same side.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await retryLastTurn({ projectId });
      } catch (e) {
        console.error("[issues] retry failed", e);
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5 pt-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleSkip}
        disabled={pending}
        className="px-2"
        title="Defer this issue and move on"
      >
        <SkipForwardIcon className="size-3" weight="duotone" />
        Skip
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleRetry}
        disabled={pending}
        className="px-2"
        title="Re-run the last turn"
      >
        <ArrowCounterClockwiseIcon className="size-3" weight="duotone" />
        Retry
      </Button>
    </div>
  );
}
