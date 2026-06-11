"use client";

// Client shell. One `useChat` whose single assistant message
// accumulates the entire run. No `setMessages` merging, no auto-fire
// loop. The renderer walks `message.parts` and partitions by
// `data-turn` boundaries.

import type { DraftViewerSourceData } from "@/lib/queries/draft-viewer";
import { RunRenderer } from "@/components/project/run-renderer";
import { revalidateProjectBySlug } from "@/lib/actions/projects";
import type { Scene } from "@/lib/project-scene";
import {
  messageRowsToUIMessages,
  type WargameUIMessage,
} from "@/lib/ui-message";
import type { Tables } from "@/types/database.types";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";

// Module-level guard. Survives React StrictMode's intentional
// double-mount in dev, which would otherwise reset a `useRef(false)`
// guard and produce a second concurrent POST to the chat route.
// Entries are never cleared — once a project has had its run started
// in this browser tab, the auto-fire is permanently disarmed.
const startedProjects = new Set<string>();

type Party = Tables<"project_parties">;
type MessageRow = Tables<"messages">;
type IssueRow = Tables<"issues">;

export function TranscriptShell({
  scene,
  parties,
  messages,
  issues,
  chatStopRef,
}: {
  scene: Extract<
    Scene,
    | { kind: "live" }
    | { kind: "live-failed" }
    | { kind: "completed" }
    | { kind: "cancelled" }
  >;
  parties?: Party[];
  messages: MessageRow[];
  issues: IssueRow[];
  chatStopRef: MutableRefObject<(() => void) | null>;
  /** Accepted to match the prop surface; ignored here (no draft
   *  viewer / no issue opener wired in). */
  onOpenIssue?: (issueId: string) => void;
  draftSources?: DraftViewerSourceData[];
  draftProposalsByMessageId?: Record<string, DraftViewerSourceData>;
}) {
  const project = scene.project;
  const isRunnable = scene.kind === "live";

  // Hydrate from the most recent persisted assistant row for this
  // project. The route writes one row per run, so this picks up any
  // prior completed run on refresh.
  // Hydrate exactly once per project. `messages` here is the SSR
  // snapshot; re-deriving it after mount would clobber the live
  // chat's in-progress state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate single-shot hydration.
  const initial = useMemo<WargameUIMessage[]>(
    () => messageRowsToUIMessages(messages),
    [project.id],
  );

  const chat = useChat<WargameUIMessage>({
    id: project.id,
    messages: initial,
    transport: new DefaultChatTransport({
      api: `/api/projects/${project.id}/chat`,
    }),
  });

  // Stop bridge for the parent's StopButton.
  useEffect(() => {
    chatStopRef.current = () => chat.stop();
    return () => {
      chatStopRef.current = null;
    };
  }, [chat.stop, chatStopRef]);

  // ONE sendMessage call per project lifetime. Fires only when:
  //   - the scene is runnable, AND
  //   - useChat is idle, AND
  //   - no assistant message exists yet (mid-run we already have
  //     one; after completion the project status flips to terminal
  //     and `isRunnable` becomes false).
  //
  // Uses a module-level set, not a useRef, because React 18
  // StrictMode remounts the component in dev — a fresh ref would
  // pass the guard a second time and fire the POST twice. The
  // server has its own atomic claim, but cheaper to not double-fire
  // in the first place.
  useEffect(() => {
    if (!isRunnable) return;
    if (chat.status !== "ready") return;
    if (startedProjects.has(project.id)) return;
    const hasAssistant = chat.messages.some((m) => m.role === "assistant");
    if (hasAssistant) return;
    startedProjects.add(project.id);
    chat.sendMessage({ text: "Start" });
  }, [isRunnable, chat.status, chat.messages, chat.sendMessage, project.id]);

  // Force a project-row refetch when the streaming POST completes.
  // The chat route updates `projects.status` via the admin client
  // mid-stream (reviewing → negotiating, then → complete). Realtime's
  // `postgres_changes` fires the supabase channel, but Next.js's
  // RSC router won't auto-refresh an open page while a fetch to that
  // page is in flight — the revalidate path triggered by the realtime
  // listener can land mid-stream and get coalesced away. After the
  // stream closes we know the route has flipped the status to
  // terminal, so we re-revalidate deterministically client-side.
  const lastStatusRef = useRef(chat.status);
  useEffect(() => {
    if (lastStatusRef.current !== chat.status) {
      console.log(
        `[poc/status] ${lastStatusRef.current} → ${chat.status} project=${project.id.slice(0, 8)} @ ${new Date().toISOString()}`,
      );
    }
    const wasStreaming =
      lastStatusRef.current === "streaming" ||
      lastStatusRef.current === "submitted";
    const nowSettled = chat.status === "ready" || chat.status === "error";
    if (wasStreaming && nowSettled && project.slug) {
      console.log(
        `[poc/status] post-stream revalidate slug=${project.slug} @ ${new Date().toISOString()}`,
      );
      void revalidateProjectBySlug(project.slug);
    }
    lastStatusRef.current = chat.status;
  }, [chat.status, project.id, project.slug]);

  // Per-party label: prefer the entity name; fall back to the role
  // (e.g. "Receiving Party") when the name is missing. We *include*
  // placeholder parties — `is_placeholder=true` just means the user
  // hasn't filled in a real entity yet, so we still get useful
  // information from the role. PanelShell already applies
  // line-clamp-1 so long names don't wrap.
  const labelFor = (predicate: (p: Party) => boolean) => {
    const labels = (parties ?? [])
      .filter(predicate)
      .map((p) => {
        const name = p.name?.trim();
        if (name) return name;
        const role = p.role?.trim();
        return role ? role : null;
      })
      .filter((s): s is string => !!s);
    return labels.length > 0 ? labels.join(" & ") : undefined;
  };
  const blueLabel = labelFor((p) => p.is_user_side === true);
  const redLabel = labelFor((p) => p.is_user_side === false);

  // Pick the most recent NON-EMPTY assistant row. A trailing row with
  // `parts: []` can sneak in if a duplicate stream races the original
  // (RCA 2026-05-20); without this filter the renderer would walk the
  // empty parts array and blank all three columns even though the real
  // transcript is sitting one row back. The route now refuses to
  // persist empty rows, but the filter is cheap defence-in-depth so
  // any rows already on disk don't poison the UI.
  const lastAssistant = [...chat.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.parts.length > 0);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <RunRenderer
        message={lastAssistant}
        status={chat.status}
        issues={issues}
        blueLabel={blueLabel}
        redLabel={redLabel}
        projectId={project.id}
      />
    </section>
  );
}
