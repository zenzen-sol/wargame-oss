"use client";
// Per-project provider override, shown above the upload dropzone on
// the file-setup scene. Visible only when the user has 2+ providers
// configured — single-key users have no choice to make. Once the
// project leaves `draft` (file uploaded + extraction starts), this
// scene unmounts and the snapshot is locked.
//
// Switching is snappy: tab clicks update local state immediately,
// and the server persist is debounced (300ms) + run in the
// background. The parent gates the Start button via
// `onPendingChange` so the user can't kick off extraction against a
// stale provider snapshot.
//
// Visual: same tab grammar as the API keys form (logo + name), so
// users learn the provider chrome once and recognise it everywhere.

import { AnthropicLogo } from "@/components/brand/anthropic";
import { OpenAILogo } from "@/components/brand/openai";
import { TabItem, TabsList, Tabs } from "@/components/ui/tabs";
import { setProjectProvider } from "@/lib/actions/projects";
import type { Provider } from "@/lib/actions/onboarding";
import type { IconComponent } from "@/lib/icon-context";
import { PROVIDER_LABELS } from "@wargame-esq/agents";
import { useEffect, useRef, useState } from "react";
import { sileo } from "sileo";

const PROVIDER_ICON: Record<Provider, IconComponent> = {
  openai: OpenAILogo as IconComponent,
  anthropic: AnthropicLogo as IconComponent,
};

const PERSIST_DEBOUNCE_MS = 300;

export function ProviderPicker({
  projectId,
  currentProvider,
  availableProviders,
  onPendingChange,
}: {
  projectId: string;
  /** The project's current snapshot (from `projects.provider`). */
  currentProvider: Provider;
  /** Providers the user has configured. Picker only renders when ≥2. */
  availableProviders: Provider[];
  /** Fires whenever a persist is scheduled or in flight. Parent uses
   *  this to disable the Start button so the user can't race an
   *  extraction kick-off against a stale snapshot. */
  onPendingChange?: (pending: boolean) => void;
}) {
  // The tab value the user is *looking at* — flips synchronously on
  // click. Decoupled from the server-truth snapshot so UI never
  // blocks waiting for the round-trip.
  const [selected, setSelected] = useState<Provider>(currentProvider);
  // True from the moment a click lands until the debounced persist
  // resolves. Drives the Start-button gate via `onPendingChange`.
  const [persisting, setPersisting] = useState(false);

  // Latest committed value, so we don't fire a no-op persist when
  // the user clicks back to where they started (or where the server
  // already is).
  const lastPersistedRef = useRef<Provider>(currentProvider);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bubble pending-ness to the parent. Cheap — boolean changes only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: callback identity is parent's problem; we only care about the boolean.
  useEffect(() => {
    onPendingChange?.(persisting);
  }, [persisting]);

  // Clean up any pending timer on unmount. The scene unmounts as
  // soon as the project leaves `draft`, and we don't want a queued
  // persist firing against a status the action will reject.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  if (availableProviders.length < 2) return null;

  function handleChange(next: Provider) {
    if (next === selected) return;
    setSelected(next);
    // A new click resets the debounce window so multiple rapid
    // switches coalesce into the final value. Show pending the
    // moment the user starts changing things.
    setPersisting(true);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void persist(next);
    }, PERSIST_DEBOUNCE_MS);
  }

  async function persist(target: Provider) {
    // No-op if the user landed back on the last-persisted value —
    // avoids a needless write when they tab back and forth.
    if (target === lastPersistedRef.current) {
      setPersisting(false);
      return;
    }
    try {
      await setProjectProvider({ projectId, provider: target });
      lastPersistedRef.current = target;
    } catch (e) {
      // Roll the visible selection back to whatever the server last
      // confirmed. The user sees their click reverted with a toast
      // explaining why — better than silently leaving the UI ahead
      // of the snapshot.
      setSelected(lastPersistedRef.current);
      sileo.error({
        title: "Couldn't switch provider",
        description: e instanceof Error ? e.message : "Try again in a moment.",
      });
    } finally {
      setPersisting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-2">
      <Tabs value={selected} onValueChange={(v) => handleChange(v as Provider)}>
        <TabsList aria-label="LLM provider for this project">
          {availableProviders.map((provider) => (
            <TabItem
              key={provider}
              value={provider}
              icon={PROVIDER_ICON[provider]}
              label={PROVIDER_LABELS[provider]}
            />
          ))}
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground text-balance max-w-sm text-center">
        Note that your provider choice is locked for this project once files are
        uploaded.
      </p>
    </div>
  );
}
