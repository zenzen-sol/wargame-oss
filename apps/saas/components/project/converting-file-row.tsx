"use client";
// Renders a `conversion_status === "pending"` file. Most rows
// transition to `done` or `failed` within a few seconds, so the
// default look is the same shimmer the PendingRow uses.
//
// If a row stays pending past `STUCK_AFTER_MS` (the conversion
// workflow has either died silently or never got the trigger
// because the workflows app was down), we morph the row into a
// "Taking longer than expected" state that offers Retry + Remove.
// Without this affordance the user is staring at an infinite
// shimmer with no way out — see the failure mode reported on
// 2026-05-17 when workflows wasn't running.

import { Button } from "@/components/ui/button";
import { removeFile, retryFileConversion } from "@/lib/actions/files";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database.types";
import { ArrowClockwiseIcon, FileTextIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState, useTransition } from "react";
import { sileo } from "sileo";

const STUCK_AFTER_MS = 90_000;

export function ConvertingFileRow({
  file,
  editable,
}: {
  file: Tables<"files">;
  /** Only allow the rescue actions on the file-setup scene. Past
   *  that the parent shouldn't render this component at all. */
  editable: boolean;
}) {
  const createdAtMs = Date.parse(file.created_at);
  const initiallyStuck =
    Number.isFinite(createdAtMs) && Date.now() - createdAtMs >= STUCK_AFTER_MS;
  const [stuck, setStuck] = useState(initiallyStuck);
  const [pending, startTransition] = useTransition();

  // Schedule one timer to flip into stuck-mode at the right moment.
  // No interval polling — a single setTimeout is enough and we
  // re-render exactly when the threshold elapses.
  useEffect(() => {
    if (stuck || !Number.isFinite(createdAtMs)) return;
    const remaining = STUCK_AFTER_MS - (Date.now() - createdAtMs);
    if (remaining <= 0) {
      setStuck(true);
      return;
    }
    const t = setTimeout(() => setStuck(true), remaining);
    return () => clearTimeout(t);
  }, [stuck, createdAtMs]);

  function handleRetry() {
    // Drop into shimmer immediately — before the server round-trip
    // — so the user sees a clear "we're retrying" beat instead of
    // disabled buttons frozen in the stuck layout for the duration
    // of the request. If the retry itself throws we restore the
    // stuck state and toast; if the retry succeeds and conversion
    // eventually completes, the row's status flips to `done` (or
    // `failed`) and the parent swaps this component out.
    setStuck(false);
    startTransition(async () => {
      try {
        await retryFileConversion({ fileId: file.id });
      } catch (e) {
        setStuck(true);
        sileo.error({
          title: "Couldn't retry conversion",
          description:
            e instanceof Error ? e.message : "Try again in a moment.",
        });
      }
    });
  }

  function handleRemove() {
    startTransition(async () => {
      try {
        await removeFile({ fileId: file.id });
      } catch (e) {
        sileo.error({
          title: "Couldn't remove file",
          description:
            e instanceof Error ? e.message : "Try again in a moment.",
        });
      }
    });
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border/60 bg-background p-5",
        !stuck && "opacity-70",
      )}
    >
      <FileTextIcon
        size={48}
        weight="light"
        className="shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{file.name}</div>
        {stuck ? (
          <div className="text-sm text-muted-foreground flex flex-col gap-2">
            <div>
              Taking longer than expected. The conversion service may be
              unreachable. Retry, or remove the file and re-upload.
            </div>
            <div className="flex flex-row gap-4">
              <Button
                type="button"
                variant="secondary"
                onClick={handleRetry}
                disabled={pending}
              >
                <ArrowClockwiseIcon size={14} weight="bold" />
                Retry
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleRemove}
                disabled={pending}
                aria-label={`Remove ${file.name}`}
              >
                <XIcon size={14} weight="bold" />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <span className="shimmer-text">Converting</span>
        )}
      </div>
      {!stuck && editable && (
        <div className="flex items-center">
          <Button
            type="button"
            variant="secondary"
            onClick={handleRemove}
            disabled={pending}
            aria-label={`Remove ${file.name}`}
          >
            <XIcon size={14} weight="bold" />
          </Button>
        </div>
      )}
    </div>
  );
}
