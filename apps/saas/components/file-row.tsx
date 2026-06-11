"use client";

import { Button } from "@/components/ui/button";
import { retryFileConversion } from "@/lib/actions/files";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import type { Tables } from "@/types/database.types";
import {
  ArrowClockwiseIcon,
  FileTextIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTransition } from "react";
import { sileo } from "sileo";

export function FileRow({
  file,
  editable,
  onRemove,
}: {
  file: Tables<"files">;
  editable: boolean;
  onRemove: () => void;
}) {
  const failed = file.conversion_status === "failed";
  const converting = file.conversion_status === "pending";
  const [retrying, startRetry] = useTransition();

  function handleRetry() {
    startRetry(async () => {
      try {
        await retryFileConversion({ fileId: file.id });
      } catch (e) {
        sileo.error({
          title: "Couldn't retry conversion",
          description:
            e instanceof Error ? e.message : "Try again in a moment.",
        });
      }
    });
  }
  return (
    <div
      className={cn(
        "group/file flex items-start gap-3 rounded-xl border border-border/60 bg-background p-5",
        failed && "border-destructive/40",
      )}
    >
      {failed ? (
        <WarningCircleIcon
          size={48}
          weight="light"
          className="shrink-0 text-destructive"
        />
      ) : (
        <FileTextIcon
          size={48}
          weight="light"
          className="shrink-0 transition-colors duration-150 ease-out"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{file.name}</div>
        <div className="text-muted-foreground">
          {converting ? (
            <span className="shimmer-text">Converting</span>
          ) : failed ? (
            <span className="text-destructive">
              Conversion failed
              {file.conversion_error ? ` — ${file.conversion_error}` : ""}
            </span>
          ) : (
            formatBytes(file.byte_size)
          )}
        </div>
        {failed && (
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
            >
              <ArrowClockwiseIcon size={14} weight="bold" />
              Retry
            </Button>
          </div>
        )}
      </div>
      {editable ? (
        <div className="flex items-center">
          <Button
            type="button"
            variant="secondary"
            onClick={onRemove}
            aria-label={`Remove ${file.name}`}
          >
            <XIcon size={14} weight="bold" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
