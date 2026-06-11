"use server";

// Server action that mints a signed read URL for a dev-drafter-test
// redline. Gated to the calling user's own prefix + dev environment.

import { requireUser } from "@/lib/auth-session";
import { createSignedRead } from "@/lib/storage";

export type DevDrafterUrlMode = "view" | "download";

export async function getDevDrafterTestUrl(args: {
  storageKey: string;
  downloadFilename?: string;
  mode?: DevDrafterUrlMode;
}): Promise<{ url: string } | { error: string }> {
  if (process.env.NODE_ENV === "production") {
    return { error: "dev-only" };
  }
  const user = await requireUser().catch(() => null);
  if (!user) return { error: "unauthenticated" };
  // Defence in depth: the key must live under the calling user's
  // prefix.
  if (!args.storageKey.startsWith(`${user.id}/dev-drafter-test/`)) {
    return { error: "forbidden" };
  }
  try {
    const url = await createSignedRead(args.storageKey, 300, {
      downloadFilename:
        args.mode === "download" ? args.downloadFilename : undefined,
    });
    return { url };
  } catch (err) {
    console.error("[dev-drafter-test] sign failed", err);
    return { error: "sign-failed" };
  }
}
