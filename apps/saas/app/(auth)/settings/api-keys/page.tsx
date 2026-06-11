import { ApiKeysSetupForm } from "@/components/onboarding/api-keys-setup-form";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth-session";
import { listConfiguredProviders } from "@/lib/byok";

export default async function ApiKeysSettingsPage() {
  const user = await requireUser();
  const existing = await listConfiguredProviders({ userId: user.id });

  return (
    <>
      <AppChrome breadcrumbs={[{ label: "API Keys" }]} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-6 py-8 lg:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-1 font-semibold text-base">
            API Keys
          </h1>
          <p className="text-muted-foreground">
            Wargame uses your own OpenAI or Anthropic API key for LLM
            interactions. Replace or remove keys here.
          </p>
        </div>

        <ApiKeysSetupForm existing={existing} mode="settings" />
      </main>
    </>
  );
}
