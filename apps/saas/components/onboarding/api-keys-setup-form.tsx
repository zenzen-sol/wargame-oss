"use client";
// Provider API-key form shared by /welcome/api-keys (onboarding)
// and /settings/api-keys (post-onboarding edits). One tab per
// provider with the provider's logo + name; each tab panel contains
// the key state (input / connected + Replace / Remove) and the
// list of models we route to per tier so the user knows what their
// key is paying for.
//
// When 2+ providers are configured a "Default for new projects"
// dropdown appears below the tabs — the choice is persisted to
// `user_api_keys.is_default` and consumed by createProject to
// snapshot `projects.provider` at create time.
//
// Removal is intentionally absent in onboarding — that's a settings
// concern. The Replace flow re-uses the same input slot.

import { AnthropicLogo } from "@/components/brand/anthropic";
import { OpenAILogo } from "@/components/brand/openai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import {
  type Provider,
  deleteApiKey,
  saveApiKey,
  setDefaultProvider,
} from "@/lib/actions/onboarding";
import type { IconComponent } from "@/lib/icon-context";
import {
  DEFAULT_MODELS,
  MODEL_OPTIONS,
  PROVIDER_LABELS,
  type ModelTier,
} from "@wargame-esq/agents";
import { CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sileo } from "sileo";

const PROVIDERS = [
  "openai",
  "anthropic",
] as const satisfies readonly Provider[];

const PROVIDER_ICON: Record<Provider, IconComponent> = {
  openai: OpenAILogo as IconComponent,
  anthropic: AnthropicLogo as IconComponent,
};

const PROVIDER_PLACEHOLDER: Record<Provider, string> = {
  openai: "sk-…",
  anthropic: "sk-ant-…",
};

const PROVIDER_DOCS_URL: Record<Provider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
};

const TIER_LABEL: Record<ModelTier, string> = {
  baseline: "Reasoning",
  drafter: "Drafting",
  low: "Fast",
};

const TIER_DESCRIPTION: Record<ModelTier, string> = {
  baseline: "Review and negotiation arguments.",
  drafter: "End-of-run redline edits against the original contract.",
  low: "Extraction and lightweight classification.",
};

// Render order for the per-provider model summary on the API keys
// form. Defined here (rather than driving off the `ModelTier`
// union order) so changing the union doesn't silently reshuffle
// what users see.
const TIER_ORDER: ModelTier[] = ["baseline", "drafter", "low"];

export type ConfiguredProvider = {
  provider: Provider;
  isDefault: boolean;
};

interface Props {
  /** Providers the user has already configured (with default flag). */
  existing: ConfiguredProvider[];
  /** Onboarding shows a Continue button; settings doesn't. */
  mode: "onboarding" | "settings";
}

export function ApiKeysSetupForm({ existing, mode }: Props) {
  const router = useRouter();
  const initialConfigured = new Map(existing.map((c) => [c.provider, c]));
  const [configured, setConfigured] =
    useState<Map<Provider, ConfiguredProvider>>(initialConfigured);
  const connectedCount = configured.size;
  const hasAny = connectedCount > 0;

  // Active tab: prefer the user's default when configured, otherwise
  // the first configured provider, otherwise the first in the list
  // (gives them somewhere to start).
  const defaultProvider =
    [...configured.values()].find((c) => c.isDefault)?.provider ?? null;
  const initialTab: Provider =
    defaultProvider ?? existing[0]?.provider ?? PROVIDERS[0];
  const [activeTab, setActiveTab] = useState<Provider>(initialTab);

  function handleSaved(provider: Provider) {
    setConfigured((prev) => {
      const next = new Map(prev);
      // First save promotes to default on the server; mirror that
      // optimistically so the dropdown shows the right label without
      // a round-trip.
      const promoteToDefault = prev.size === 0;
      // Preserve existing default flag if it already exists for
      // this provider (a Replace flow shouldn't clear it).
      const wasDefault = prev.get(provider)?.isDefault ?? false;
      next.set(provider, {
        provider,
        isDefault: promoteToDefault || wasDefault,
      });
      return next;
    });
    router.refresh();
  }

  function handleRemoved(provider: Provider) {
    setConfigured((prev) => {
      const next = new Map(prev);
      const wasDefault = prev.get(provider)?.isDefault ?? false;
      next.delete(provider);
      // Mirror server-side default reassignment so the UI stays
      // honest until refresh lands. Pick the survivor alphabetically
      // (matches the server's `order("provider", asc)`).
      if (wasDefault) {
        const survivor = [...next.keys()].sort()[0];
        const row = survivor ? next.get(survivor) : undefined;
        if (survivor && row) {
          next.set(survivor, { ...row, isDefault: true });
        }
      }
      return next;
    });
    router.refresh();
  }

  function handleSetDefault(provider: Provider) {
    setConfigured((prev) => {
      const next = new Map(prev);
      for (const [p, row] of next) {
        next.set(p, { ...row, isDefault: p === provider });
      }
      return next;
    });
    void (async () => {
      const result = await setDefaultProvider({ provider });
      if (!result.ok) {
        sileo.error({
          title: "Couldn't update default",
          description: result.message ?? "Try again.",
        });
        // Revert by re-fetching from the server.
        router.refresh();
        return;
      }
      router.refresh();
    })();
  }

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as Provider)}
      >
        <TabsList className="justify-start">
          {PROVIDERS.map((provider) => (
            <TabItem
              key={provider}
              value={provider}
              icon={PROVIDER_ICON[provider]}
              label={PROVIDER_LABELS[provider]}
            />
          ))}
        </TabsList>

        {PROVIDERS.map((provider) => (
          <TabPanel
            key={provider}
            value={provider}
            className="flex flex-col gap-6 pt-6"
          >
            <ProviderPanel
              provider={provider}
              connected={configured.has(provider)}
              isDefault={configured.get(provider)?.isDefault ?? false}
              allowRemove={mode === "settings"}
              onSaved={() => handleSaved(provider)}
              onRemoved={() => handleRemoved(provider)}
            />
            <ModelsSummary provider={provider} />
          </TabPanel>
        ))}
      </Tabs>

      {mode === "onboarding" && <OnboardingFooter hasAny={hasAny} />}
      {mode === "settings" && (
        <SettingsFooter
          activeProvider={activeTab}
          isActiveDefault={configured.get(activeTab)?.isDefault ?? false}
          isActiveConnected={configured.has(activeTab)}
          onMakeDefault={() => handleSetDefault(activeTab)}
        />
      )}
    </div>
  );
}

function SettingsFooter({
  activeProvider,
  isActiveDefault,
  isActiveConnected,
  onMakeDefault,
}: {
  activeProvider: Provider;
  isActiveDefault: boolean;
  isActiveConnected: boolean;
  onMakeDefault: () => void;
}) {
  const router = useRouter();
  // "Make default" applies to the currently-viewed tab. We keep it
  // mounted (rather than conditionally rendered) so the row's
  // justify-between layout stays stable as the user flips tabs;
  // disable when the action would be a no-op (already default) or
  // invalid (no key for this provider).
  const cannotMakeDefault = isActiveDefault || !isActiveConnected;
  const label = isActiveDefault
    ? `${PROVIDER_LABELS[activeProvider]} is default`
    : `Make ${PROVIDER_LABELS[activeProvider]} default`;
  return (
    <div className="mt-8 flex items-center justify-between gap-4">
      <Button
        type="button"
        variant="secondary"
        onClick={onMakeDefault}
        disabled={cannotMakeDefault}
      >
        {label}
      </Button>
      <Button type="button" size="lg" onClick={() => router.push("/")}>
        Done
      </Button>
    </div>
  );
}

function OnboardingFooter({ hasAny }: { hasAny: boolean }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } catch (e) {
      console.error("[auth] signOut threw", e);
    }
    router.push("/sign-in");
  }

  // Sign out is an escape hatch from the onboarding step — a user
  // who landed on the wrong account or wants to bail before
  // pasting keys needs a way out without using the chrome menu
  // (which isn't rendered during onboarding). Pair it with the
  // Continue CTA on a single justified row so both actions read
  // as siblings, not a primary + buried option.
  return (
    <div className="flex items-center justify-between gap-4">
      <Button
        type="button"
        variant="link"
        onClick={handleSignOut}
        disabled={signingOut}
        className="text-muted-foreground hover:text-foreground"
      >
        {signingOut ? "Signing out" : "Sign out"}
      </Button>
      <Button
        type="button"
        size="lg"
        disabled={!hasAny}
        onClick={() => router.push("/")}
      >
        Continue
      </Button>
    </div>
  );
}

function ProviderPanel({
  provider,
  connected,
  isDefault,
  allowRemove,
  onSaved,
  onRemoved,
}: {
  provider: Provider;
  connected: boolean;
  isDefault: boolean;
  /** Settings mode only — hides in onboarding so users can't
   *  accidentally undo their progress with one click. */
  allowRemove: boolean;
  onSaved: () => void;
  onRemoved: () => void;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!connected);
  const [pending, startTransition] = useTransition();
  const inputId = `api-key-${provider}`;

  function remove() {
    startTransition(async () => {
      await deleteApiKey({ provider });
      setEditing(true);
      onRemoved();
    });
  }

  function submit() {
    const apiKey = value.trim();
    if (!apiKey) return;
    startTransition(async () => {
      const result = await saveApiKey({ provider, apiKey });
      if (!result.ok) {
        sileo.error({
          title: `${PROVIDER_LABELS[provider]} key didn't save`,
          description: result.message ?? "Could not validate key.",
        });
        return;
      }
      sileo.success({
        title: `${PROVIDER_LABELS[provider]} key saved`,
        description: "Validated and stored.",
      });
      setValue("");
      setEditing(false);
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="font-medium text-foreground">
          API key
        </label>
        {connected && !editing && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckIcon size={16} />
            Connected
            {isDefault && (
              <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-xs">
                Default
              </span>
            )}
          </span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex gap-2"
          >
            <Input
              id={inputId}
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={PROVIDER_PLACEHOLDER[provider]}
              disabled={pending}
              autoComplete="off"
              spellCheck={false}
              className="flex-1 font-mono"
            />
            <Button type="submit" size="lg" disabled={pending || !value.trim()}>
              {pending ? "Saving" : "Save"}
            </Button>
            {connected && (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => {
                  setValue("");
                  setEditing(false);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            )}
          </form>
          <a
            href={PROVIDER_DOCS_URL[provider]}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-sm text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
          >
            Get an {PROVIDER_LABELS[provider]} API key
          </a>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-muted-foreground tabular-nums">
            {PROVIDER_PLACEHOLDER[provider].replace("…", "••••••••••••")}
          </span>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="link"
              onClick={() => setEditing(true)}
              disabled={pending}
            >
              Replace
            </Button>
            {allowRemove && (
              <Button
                type="button"
                variant="link"
                onClick={remove}
                disabled={pending}
                className="text-destructive/80 hover:text-destructive decoration-destructive/40"
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelsSummary({ provider }: { provider: Provider }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-medium text-foreground">Models used</div>
      <ul className="flex flex-col gap-4 rounded-lg border border-border/60 bg-muted/30 p-6 text-sm">
        {TIER_ORDER.map((tier) => {
          const id = DEFAULT_MODELS[provider][tier];
          const option = MODEL_OPTIONS[provider].find((o) => o.value === id);
          return (
            <li key={tier}>
              <div className="text-foreground">{TIER_LABEL[tier]}</div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex flex-col">
                  <div className="text-muted-foreground leading-5">
                    {TIER_DESCRIPTION[tier]}
                  </div>
                </div>
                <div className="text-muted-foreground text-right shrink-0 flex flex-row space-x-2">
                  {option?.label ?? id}
                  {option?.costTier && (
                    <div className="ml-2 text-foreground/60">
                      {option.costTier}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href="/poll"
        className="self-start text-muted-foreground text-sm underline underline-offset-4 decoration-dotted hover:text-foreground"
      >
        Why these models?
      </Link>
    </div>
  );
}

