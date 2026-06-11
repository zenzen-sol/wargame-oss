"use client";

import { ProjectFilesSection } from "@/components/project-files-section";
import { Button } from "@/components/ui/button";
import type { Scene } from "@/lib/project-scene";
import type { Tables } from "@/types/database.types";
import {
  ArrowCounterClockwiseIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

type FileRow = Tables<"files">;

export function ExtractionFailedBody({
  scene,
  retrying,
  files,
  onRetryExtraction,
}: {
  scene: Extract<Scene, { kind: "extraction-failed" }>;
  retrying: boolean;
  files: FileRow[];
  onRetryExtraction: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4 max-w-prose mx-auto">
        <div className="flex items-start gap-3">
          <WarningCircleIcon
            weight="duotone"
            className="size-5 shrink-0 text-destructive"
          />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Extraction failed.</p>
            <p className="text-destructive">{scene.error}</p>
            <p className="text-muted-foreground">
              Retrying clears the partial output and starts over from the file
              you uploaded. You can also remove or replace the file first.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onRetryExtraction}
            disabled={retrying}
            variant="outline"
          >
            <ArrowCounterClockwiseIcon className="size-4" />
            {retrying ? "Resetting" : "Retry extraction"}
          </Button>
        </div>
      </div>
      <ProjectFilesSection project={scene.project} files={files} disabled />
    </>
  );
}
