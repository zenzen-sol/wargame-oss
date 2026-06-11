"use client";
// Subscribes to every project-scoped table and asks the server to
// revalidate the project's path when any row changes. The Convex-
// reactive-query replacement: SSR loads the data, Realtime nudges
// the server to invalidate its data cache, and Next streams fresh
// server-component output back to the client.
//
// One channel per project, six table subscriptions on it. Filters
// are server-side (Postgres LISTEN/NOTIFY) so we don't ship every
// other project's deltas across the wire. RLS still gates which
// rows actually reach the client.
//
// Coalesce: the chat route's onFinish typically inserts a message
// row + bumps an issue row + bumps the project row in quick
// succession. We don't want three separate server-action round
// trips for one logical event. Trailing-edge debounce at 200ms
// turns a burst of postgres_changes into one revalidate.
import { revalidateProjectBySlug } from "@/lib/actions/projects";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef } from "react";

const COALESCE_MS = 200;

export function useProjectRealtime(projectId: string, slug: string): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`project:${projectId}`);
    const tag = `[realtime ${projectId.slice(0, 8)}]`;
    let eventCount = 0;
    const scheduleRevalidate = (table: string) => () => {
      eventCount += 1;
      console.log(
        `${tag} event #${eventCount} table=${table} @ ${new Date().toISOString()}`,
      );
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const fireAt = new Date().toISOString();
        console.log(
          `${tag} firing revalidateProjectBySlug after ${COALESCE_MS}ms debounce @ ${fireAt}`,
        );
        void revalidateProjectBySlug(slug).then(
          () => console.log(`${tag} revalidate resolved @ ${new Date().toISOString()}`),
          (err) => console.warn(`${tag} revalidate rejected`, err),
        );
      }, COALESCE_MS);
    };

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` },
      scheduleRevalidate("projects"),
    );
    for (const table of [
      "files",
      "project_parties",
      "interview_answers",
      "issues",
      "messages",
      "outputs",
    ]) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `project_id=eq.${projectId}`,
        },
        scheduleRevalidate(table),
      );
    }
    channel.subscribe((status, err) => {
      console.log(
        `${tag} channel.subscribe status=${status} @ ${new Date().toISOString()}`,
        err ?? "",
      );
    });
    return () => {
      console.log(`${tag} unmount, removing channel`);
      if (timerRef.current) clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [projectId, slug]);
}
