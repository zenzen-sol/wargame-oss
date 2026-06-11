"use client";

import { StatusLine } from "@/components/project/status-line";
import type { Scene } from "@/lib/project-scene";

function describeFailure(error: string): string | undefined {
  const trimmed = error.trim();
  if (!trimmed || /^unknown/i.test(trimmed)) return undefined;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function StatusIndicator({
  scene,
  onPartsClick,
}: {
  scene: Scene;
  onPartsClick?: () => void;
}) {
  switch (scene.kind) {
    case "file-setup":
    case "extracting":
    case "extraction-failed":
    case "setup":
      // All pre-live scenes are responsible for surfacing their own
      // activity inline next to the action they replace, so the
      // header stays quiet and there's only one place to look.
      return null;
    case "live": {
      const { phase, issuesProgress, currentIssue } = scene;
      if (phase === "reviewing" || issuesProgress.total === 0) {
        return <StatusLine tone="active" pulse heading="Reviewing" />;
      }
      // Monotone progress: count of resolved issues over total in the
      // run queue. Previously this slot flipped between
      // `currentIssue.index` and `resolved` depending on whether an
      // issue was in_negotiation, which produced a non-monotonic
      // 2/3 → 1/3 → 2/3 flap between turns under realtime updates.
      const progress = `${issuesProgress.resolved}/${issuesProgress.total} resolved`;
      return (
        <StatusLine
          tone="active"
          pulse
          heading="Negotiating"
          subheading={currentIssue?.title}
          parts={[progress]}
          onPartsClick={onPartsClick}
        />
      );
    }
    case "live-failed": {
      const upstream = describeFailure(scene.error);
      return (
        <StatusLine
          tone="error"
          heading="Failed"
          parts={upstream ? [upstream] : undefined}
          onPartsClick={onPartsClick}
        />
      );
    }
    case "completed": {
      const { issueStats } = scene;
      const negotiated =
        issueStats.agreed +
        issueStats.pendingInput +
        issueStats.escalated +
        issueStats.impasse;
      const parts: string[] = [`${issueStats.agreed}/${negotiated} Agreed`];
      if (issueStats.pendingInput > 0)
        parts.push(`${issueStats.pendingInput} Pending input`);
      if (issueStats.impasse > 0) parts.push(`${issueStats.impasse} Impasse`);
      if (issueStats.escalated > 0)
        parts.push(`${issueStats.escalated} Escalated`);
      if (issueStats.unresolved > 0)
        parts.push(`${issueStats.unresolved} Unresolved`);
      if (issueStats.deferred > 0)
        parts.push(`${issueStats.deferred} Deferred`);
      // Completed runs read as a neutral terminal state — no dot,
      // foreground-colored heading. The presence of stats already
      // communicates whether any issues failed to resolve.
      return (
        <StatusLine
          tone="success"
          noDot
          headingForeground
          heading="Completed"
          parts={parts}
          onPartsClick={onPartsClick}
        />
      );
    }
    case "cancelled":
      return (
        <StatusLine
          tone="warning"
          noDot
          headingForeground
          heading="Cancelled"
          onPartsClick={onPartsClick}
        />
      );
  }
}
