"use server";
import { revalidatePath } from "next/cache";

// Pure cache buster invoked from PasskeysView after a Better-Auth
// client call (`authClient.passkey.*`) mutates the passkey table.
// Better-Auth client methods don't go through a Next server action,
// so they can't call revalidatePath themselves.
export async function revalidatePasskeys(): Promise<void> {
  revalidatePath("/settings/passkeys");
}
