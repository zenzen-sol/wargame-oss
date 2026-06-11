import { requireUser } from "@/lib/auth-session";
import { listConfiguredProviders } from "@/lib/byok";
import { getOnboardingFlags } from "@/lib/onboarding";
import { ApiKeysSetupForm } from "@/components/onboarding/api-keys-setup-form";
import { redirect } from "next/navigation";

// Onboarding step: collect at least one provider's API key before
// letting the user into the app. Skipping ahead is allowed once any
// key is configured — they can come back to /settings/api-keys to
// add the other or to manage existing ones.
//
// Frame mirrors the disclaimer page (mx-auto max-w-lg, py-10,
// justify-between, prose-led). No heading — the prose introduces
// the requirement and the form is the focal action.
export default async function ApiKeysOnboardingPage() {
  const user = await requireUser();
  const flags = await getOnboardingFlags(user.id);
  if (!flags.acknowledgedDisclaimer) {
    redirect("/welcome/disclaimer");
  }
  // Don't auto-redirect when the user already has a key. The user
  // may have just saved their first one and might want to add the
  // second provider before clicking Continue. The (auth) layout
  // gate already handles the "fully onboarded user going to /" path.
  const existing = await listConfiguredProviders({ userId: user.id });

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-between px-6 py-10">
      <div>&nbsp;</div>

      <div className="flex flex-col items-stretch gap-8">
        <div className="text-base">
          <p className="text-pretty">
            Wargame uses your own OpenAI or Anthropic API key for LLM
            interactions. Add at least one to continue.
          </p>
          <p className="mt-4 text-pretty text-muted-foreground">
            Keys are encrypted at rest. You can add either provider, or both.
            You'll be able to update them later, as needed.
          </p>
        </div>

        <ApiKeysSetupForm existing={existing} mode="onboarding" />
      </div>

      <div>&nbsp;</div>
    </main>
  );
}
