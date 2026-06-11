import { acceptDisclaimer } from "@/lib/actions/onboarding";
import { requireUser } from "@/lib/auth-session";
import { getOnboardingFlags, nextOnboardingStep } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";

// One-time legal disclaimer acceptance. Server-rendered form — the
// Accept button posts to acceptDisclaimer, which stamps
// disclaimer_acknowledged_at and the (auth) layout's onboarding gate
// re-evaluates on the next navigation. We redirect explicitly here
// rather than relying on the gate so the user lands on the right
// next step (api-keys or home) without an extra round-trip.
export default async function DisclaimerPage() {
  const user = await requireUser();
  const flags = await getOnboardingFlags(user.id);
  if (flags.acknowledgedDisclaimer) {
    // Already done; skip ahead.
    const next = nextOnboardingStep(flags);
    redirect(next ?? "/");
  }

  async function handleAccept() {
    "use server";
    await acceptDisclaimer();
    // Refresh the flag and pick the next destination — keys form if
    // none configured, home if they are.
    const u = await requireUser();
    const f = await getOnboardingFlags(u.id);
    redirect(nextOnboardingStep(f) ?? "/");
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-between px-6 py-10">
      <div>&nbsp;</div>

      <div className="flex flex-col items-stretch gap-8">
        <div className="text-base">
          <p className="text-pretty">
            Wargame is an AI tool that helps you explore negotiation strategies
            for contracts. It doesn&rsquo;t provide legal advice, and its
            outputs are not a substitute for the judgment of a licensed
            attorney. Decisions about contracts and negotiations are yours
            alone.
          </p>
          <p className="mt-4 text-pretty">
            By continuing, you acknowledge this and agree that Wargame and its
            operators are not liable for outcomes based on the tool&apos;s
            output.
          </p>
        </div>

        <form action={handleAccept}>
          <Button type="submit" size="lg">
            I understand
          </Button>
        </form>
      </div>

      <div>&nbsp;</div>
    </main>
  );
}
