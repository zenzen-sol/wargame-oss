"use client";

import { AnthropicLogo } from "@/components/brand/anthropic";
import { OpenAILogo } from "@/components/brand/openai";
import { UsageRow } from "@/components/project/usage-row";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { Provider } from "@/lib/actions/onboarding";
import type { Scene } from "@/lib/project-scene";
import { cn } from "@/lib/utils";
import { PROVIDER_LABELS } from "@wargame-esq/agents";

export interface RunUsage {
  callCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  estimatedCostUsd?: number;
  lastCall?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    modelId?: string;
  };
}

const USAGE_SCENES: ReadonlySet<Scene["kind"]> = new Set([
  "live",
  "live-failed",
  "completed",
  "cancelled",
]);

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function UsageMeter({
  scene,
  usage,
  provider,
}: {
  scene: Scene;
  usage: RunUsage | null;
  /** Project's snapshotted provider. Rendered as a small leading
   *  badge on the chip so the user knows which model family is
   *  accruing the cost they're staring at. Null only for legacy
   *  pre-BYOK rows that never had a snapshot. */
  provider: Provider | null;
}) {
  if (!USAGE_SCENES.has(scene.kind)) return null;
  const callCount = usage?.callCount ?? 0;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const reasoningTokens = usage?.reasoningTokens ?? 0;
  const cachedInputTokens = usage?.cachedInputTokens ?? 0;
  const cost = usage?.estimatedCostUsd ?? 0;
  const totalTokens = inputTokens + outputTokens + reasoningTokens;
  const lastCall = usage?.lastCall;

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <button
            type="button"
            aria-label="Run usage details"
            className={cn(
              // Lock to a generous min-width so the chip never shrinks
              // the StatusIndicator (left) as the digits grow — that
              // shrinkage was wrapping the subheading and pulling the
              // rest of the page up a row's height mid-run.
              "ml-auto hidden shrink-0 min-w-[16rem] cursor-help items-center justify-end gap-x-2 text-muted-foreground tabular-nums sm:flex",
            )}
          >
            {provider && (
              <>
                <span className="flex items-center gap-1.5 text-foreground/80">
                  {provider === "anthropic" ? (
                    <AnthropicLogo size={12} />
                  ) : (
                    <OpenAILogo size={12} />
                  )}
                  <span>{PROVIDER_LABELS[provider]}</span>
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>
              {callCount} call{callCount === 1 ? "" : "s"}
            </span>
            <span aria-hidden>·</span>
            <span>{formatTokens(totalTokens)} tok</span>
            <span aria-hidden>·</span>
            <span>~${cost.toFixed(cost < 0.01 ? 4 : 2)}</span>
          </button>
        }
      />
      <HoverCardContent align="end" className="w-64">
        <div className="flex flex-col gap-1.5">
          <UsageRow label="Input" value={formatTokens(inputTokens)} />
          {cachedInputTokens > 0 && (
            <UsageRow
              label="Cached"
              value={formatTokens(cachedInputTokens)}
              muted
            />
          )}
          <UsageRow label="Output" value={formatTokens(outputTokens)} />
          {reasoningTokens > 0 && (
            <UsageRow label="Reasoning" value={formatTokens(reasoningTokens)} />
          )}
          <div className="my-1 border-t" />
          <UsageRow
            label="Total"
            value={`${formatTokens(totalTokens)} tok`}
            strong
          />
          <UsageRow
            label="Estimated cost"
            value={`~$${cost.toFixed(cost < 0.01 ? 4 : 2)}`}
            strong
          />
          {lastCall && (
            <>
              <div className="my-1 border-t" />
              <p className="text-muted-foreground">
                Latest call: {formatTokens(lastCall.inputTokens)} in /{" "}
                {formatTokens(lastCall.outputTokens)} out
                {lastCall.reasoningTokens && lastCall.reasoningTokens > 0
                  ? ` + ${formatTokens(lastCall.reasoningTokens)} reasoning`
                  : ""}
                {lastCall.modelId ? ` · ${lastCall.modelId}` : ""}
              </p>
            </>
          )}
          <p className="text-muted-foreground">
            Estimated locally; not a billing source.
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

