"use client";

import { IssueRunControls } from "@/components/issues/issue-run-controls";
import { ResolutionBlock } from "@/components/issues/resolution-block";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database.types";
import { CircleNotchIcon } from "@phosphor-icons/react";

type Issue = Tables<"issues">;

const SEVERITY_LABEL: Record<Issue["severity"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SEVERITY_TONE: Record<Issue["severity"], string> = {
  critical: "text-destructive",
  high: "text-amber-600 dark:text-amber-400",
  medium: "text-foreground",
  low: "text-muted-foreground",
};

const STATUS_LABEL: Record<Issue["status"], string> = {
  open: "Open",
  in_negotiation: "In negotiation",
  agreed: "Agreed",
  escalated: "Escalated",
  impasse: "Impasse",
  deferred: "Deferred",
  unresolved: "Unresolved",
};

export function IssueCard({
  issue,
  projectId,
  interactive,
  highlighted,
}: {
  issue: Issue;
  projectId: string;
  interactive: boolean;
  highlighted?: boolean;
}) {
  const negotiating = issue.status === "in_negotiation";
  return (
    <article
      id={`issue-${issue.id}`}
      data-status={issue.status}
      data-severity={issue.severity}
      className={cn(
        "flex flex-col gap-2 scroll-mt-6 text-base transition-colors",
        issue.status === "deferred" && "opacity-60",
        // Brief pulse to confirm landing when the user clicked an
        // issue link in the transcript.
        highlighted && "bg-accent/20 ring-1 ring-accent/40",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium leading-snug text-foreground">
          {issue.title}
        </h3>
        <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
          {negotiating && <CircleNotchIcon className="size-3 animate-spin" />}
        </span>
      </header>
      <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
        {issue.summary}
      </p>
      <ResolutionBlock issue={issue} />
      {interactive && negotiating && <IssueRunControls projectId={projectId} />}
    </article>
  );
}
