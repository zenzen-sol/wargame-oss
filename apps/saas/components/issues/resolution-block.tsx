"use client";

import { ResolutionRow } from "@/components/issues/resolution-row";
import type { Tables } from "@/types/database.types";

type Issue = Tables<"issues">;

type Resolution =
  | { kind: "agreed"; clauseLanguage: string }
  | { kind: "escalated"; escalationQuestion: string }
  | { kind: "impasse"; impasseSummary: string }
  | { kind: "deferred"; reason: string }
  | { kind: "unresolved"; reason: string };

export function ResolutionBlock({ issue }: { issue: Issue }) {
  const r = issue.resolution as Resolution | null;
  if (!r) return null;
  if (r.kind === "agreed") {
    return (
      <ResolutionRow
        label="Agreed language"
        labelTone="text-emerald-700 dark:text-emerald-400"
        body={r.clauseLanguage}
      />
    );
  }
  if (r.kind === "escalated") {
    return (
      <ResolutionRow
        label="For the principals"
        labelTone="text-orange-700 dark:text-orange-400"
        body={r.escalationQuestion}
      />
    );
  }
  if (r.kind === "impasse") {
    return (
      <ResolutionRow
        label="Impasse"
        labelTone="text-destructive"
        body={r.impasseSummary}
        muted
      />
    );
  }
  if (r.kind === "deferred") {
    return (
      <ResolutionRow
        label="Deferred"
        labelTone="text-foreground"
        body={r.reason}
        muted
      />
    );
  }
  return (
    <ResolutionRow
      label="Unresolved"
      labelTone="text-foreground dark:text-foreground"
      body={r.reason}
      muted
    />
  );
}
