import { requireUser } from "@/lib/auth-session";
import type { PropsWithChildren } from "react";

// Onboarding shell. Looser gate than (auth)/layout.tsx — only checks
// that the user is signed in, not that they've completed the
// disclaimer or added an API key, because THIS group is where they
// do those things. Each page inside /welcome handles its own
// already-done short-circuit (e.g. disclaimer page redirects to
// /welcome/api-keys if the user already acknowledged).
export default async function WelcomeLayout({ children }: PropsWithChildren) {
  await requireUser();
  return <div className="flex h-svh flex-col">{children}</div>;
}
