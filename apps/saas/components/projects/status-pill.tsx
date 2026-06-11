import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  draft: "draft",
  extracting: "extracting",
  ready_for_interview: "confirm parties",
  interviewing: "interview",
  reviewing: "reviewing",
  negotiating: "negotiating",
  complete: "complete",
  complete_with_impasses: "complete*",
  failed: "failed",
  cancelling: "cancelled",
  cancelled: "cancelled",
};

const STATUS_TONE: Record<string, string> = {
  draft: "text-muted-foreground",
  extracting: "text-sky-500",
  ready_for_interview: "text-muted-foreground",
  interviewing: "text-muted-foreground",
  reviewing: "text-sky-500",
  negotiating: "text-sky-500",
  complete: "text-emerald-500",
  complete_with_impasses: "text-amber-500",
  failed: "text-destructive",
  cancelling: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};

export function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const tone = STATUS_TONE[status] ?? "text-muted-foreground";
  return (
    <span
      className={cn(
        "text-xs font-medium uppercase tracking-wider tabular-nums",
        tone,
      )}
    >
      {label}
    </span>
  );
}
