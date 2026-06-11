import { getSessionUser } from "@/lib/auth-session";
import { getOnboardingFlags, nextOnboardingStep } from "@/lib/onboarding";
import { redirect } from "next/navigation";
import type { PropsWithChildren } from "react";

export default async function AuthedLayout({ children }: PropsWithChildren) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  // Gate on onboarding prerequisites. The welcome routes live under a
  // separate (welcome) group so they're not blocked by their own gate;
  // see app/(welcome)/welcome/layout.tsx.
  const flags = await getOnboardingFlags(user.id);
  const next = nextOnboardingStep(flags);
  if (next) redirect(next);

  return <div className="flex h-svh flex-col">{children}</div>;
}
