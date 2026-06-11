"use client";

import { cn } from "@/lib/utils";
import { FileTextIcon } from "@phosphor-icons/react";

export function PendingRow({
  name,
  label = "Uploading",
}: {
  name: string;
  /** Shimmer copy under the filename. Defaults to "Uploading"; the
   *  files section reuses this same shape with "Converting" while the
   *  extraction workflow runs, so the transition from upload → convert
   *  is seamless visually. */
  label?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border/60 bg-background p-5 opacity-70",
      )}
    >
      <FileTextIcon
        size={48}
        weight="light"
        className="shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <span className="shimmer-text">{label}</span>
      </div>
    </div>
  );
}
