"use client";

import { StatusIndicator } from "@/components/project/status-indicator";
import { StopButton } from "@/components/project/stop-button";
import {
  type RunUsage,
  UsageMeter,
} from "@/components/project/usage-meter";
import type { Scene } from "@/lib/project-scene";
import type { Tables } from "@/types/database.types";

type Project = Tables<"projects">;

export function ProjectHeader({
  project,
  scene,
  errorMessage,
  isStoppable,
  onStop,
  onPartsClick,
}: {
  project: Project;
  scene: Scene;
  errorMessage: string;
  isStoppable: boolean;
  onStop: () => void;
  onPartsClick?: () => void;
}) {
  return (
    <header className="flex flex-col gap-2">
      {/* min-h-9 reserves the StopButton's row height (h-9) for the
       *  entire header row, so the layout doesn't collapse the
       *  moment a run completes and `isStoppable` flips false.
       *  Without this, every project shifts ~12px upward when the
       *  status flips from Negotiating to Completed. */}
      <div className="flex min-h-9 min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <StatusIndicator scene={scene} onPartsClick={onPartsClick} />
        </div>
        <UsageMeter
          scene={scene}
          usage={project.run_usage as RunUsage | null}
          provider={
            project.provider === "openai" || project.provider === "anthropic"
              ? project.provider
              : null
          }
        />
        {isStoppable && <StopButton onStop={onStop} />}
      </div>
      {errorMessage && <p className="text-destructive">{errorMessage}</p>}
    </header>
  );
}
