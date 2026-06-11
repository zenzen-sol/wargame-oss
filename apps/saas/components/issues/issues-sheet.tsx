"use client";
// Issues live in a slide-out Sheet to keep the carefully-tuned
// three-column transcript intact. Trigger lives on the status bar
// (the "n/m Agreed" / "n/m" progress text).

import { IssueCard } from "@/components/issues/issue-card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Tables } from "@/types/database.types";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type Issue = Tables<"issues">;

const SEVERITY_RANK: Record<Issue["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const STATUS_RANK: Record<Issue["status"], number> = {
  in_negotiation: 0,
  open: 1,
  agreed: 2,
  escalated: 2,
  impasse: 2,
  unresolved: 2,
  deferred: 3,
};

function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const sr = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (sr !== 0) return sr;
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function IssuesSheet({
  open,
  onOpenChange,
  issues,
  projectId,
  interactive = false,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: Issue[];
  projectId: string;
  interactive?: boolean;
  /** When set, scroll to the targeted issue and pulse-highlight it
   *  after the sheet is open. The nonce lets the parent re-trigger
   *  the same target by bumping it. */
  target?: { id: string; nonce: number } | null;
}) {
  const sorted = sortIssues(issues);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // After the sheet opens (or the target changes while it's open),
  // scroll the requested issue into view and run a brief highlight
  // pulse so the user knows where they landed.
  useEffect(() => {
    if (!open || !target) return;
    // Wait one frame for the sheet's open animation to start so the
    // scroll lands in the right place.
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `#issue-${CSS.escape(target.id)}`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightedId(target.id);
    });
    const clear = setTimeout(() => setHighlightedId(null), 1400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [open, target]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!sm:max-w-lg flex w-full flex-col gap-0 sm:max-w-lg!"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>Issues</SheetTitle>
          <SheetDescription className="sr-only">
            {issues.length} issue{issues.length === 1 ? "" : "s"} raised during
            this run.
          </SheetDescription>
        </SheetHeader>
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-6 py-6"
        >
          {sorted.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-4 py-4 text-muted-foreground">
              <CircleNotchIcon className="size-4 shrink-0 animate-spin" />
              <p>
                Issues will appear here as Blue and Red surface them during the
                review.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-6">
              {sorted.map((issue) => (
                <li key={issue.id}>
                  <IssueCard
                    issue={issue}
                    projectId={projectId}
                    interactive={interactive}
                    highlighted={highlightedId === issue.id}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
