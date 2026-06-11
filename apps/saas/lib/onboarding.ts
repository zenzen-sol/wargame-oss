import "server-only";
// Onboarding state — used by (auth)/layout.tsx to gate access and by
// each welcome page to short-circuit when its prerequisite is already
// satisfied. Two flags right now:
//   - acknowledgedDisclaimer: user has clicked Accept on /welcome/disclaimer
//   - hasAnyApiKey:           user has at least one provider configured
//
// The DB queries are React.cache-wrapped per request so the layout
// and the page it renders share a single round-trip each.
import { createAdminClient } from "@/lib/supabase/admin";
import { cache } from "react";

export interface OnboardingFlags {
  acknowledgedDisclaimer: boolean;
  hasAnyApiKey: boolean;
}

export const getOnboardingFlags = cache(
  async (userId: string): Promise<OnboardingFlags> => {
    const admin = createAdminClient();

    const [userRow, keysRow] = await Promise.all([
      admin
        .from("user")
        .select("disclaimer_acknowledged_at")
        .eq("id", userId)
        .maybeSingle(),
      admin
        .from("user_api_keys")
        .select("provider", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

    return {
      acknowledgedDisclaimer: Boolean(
        userRow.data?.disclaimer_acknowledged_at,
      ),
      hasAnyApiKey: (keysRow.count ?? 0) > 0,
    };
  },
);

/** The path the user should be on next, given their onboarding state.
 *  Returns null when they're fully onboarded. */
export function nextOnboardingStep(flags: OnboardingFlags): string | null {
  if (!flags.acknowledgedDisclaimer) return "/welcome/disclaimer";
  if (!flags.hasAnyApiKey) return "/welcome/api-keys";
  return null;
}
