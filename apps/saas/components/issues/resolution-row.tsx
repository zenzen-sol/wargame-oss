"use client";

import { cn } from "@/lib/utils";

export function ResolutionRow({
  label,
  labelTone,
  body,
  muted,
}: {
  label: string;
  labelTone: string;
  body: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <span
        className={cn(
          "font-semibold uppercase tracking-wide text-xs",
          labelTone,
        )}
      >
        {label}
      </span>
      <p
        className={cn(
          "whitespace-pre-wrap leading-relaxed",
          muted ? "text-muted-foreground" : "text-foreground/90",
        )}
      >
        {body}
      </p>
    </div>
  );
}
