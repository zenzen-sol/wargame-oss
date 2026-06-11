"use client";

import { type Passkey, PasskeyRow } from "@/components/passkey-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { revalidatePasskeys } from "@/lib/actions/passkeys";
import { authClient } from "@/lib/auth-client";
import { FingerprintSimpleIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

// Sensible default we suggest if the user hasn't typed anything when
// they click "Add passkey." Better than persisting null and showing
// "Unnamed passkey" forever — they can always rename it later.
function defaultName(existingCount: number): string {
  return `Wargame Passkey ${existingCount + 1}`;
}

export function PasskeysView({ passkeys }: { passkeys: Passkey[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [draftName, setDraftName] = useState("");

  // Better-Auth's passkey calls run client-side and mutate the
  // `passkey` table directly — they don't go through a Next server
  // action, so revalidatePath alone doesn't refetch this RSC. Pair
  // it with router.refresh() so the list actually re-renders.
  const refreshList = useCallback(async () => {
    await revalidatePasskeys();
    router.refresh();
  }, [router]);

  function handleEnroll() {
    setError(null);
    const name = draftName.trim() || defaultName(passkeys.length);
    startTransition(async () => {
      const { error } = await authClient.passkey.addPasskey({ name });
      if (error) {
        setError(error.message ?? "Could not register passkey");
        return;
      }
      setDraftName("");
      await refreshList();
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const { error } = await authClient.passkey.deletePasskey({ id });
      if (error) {
        setError(error.message ?? "Could not delete passkey");
        return;
      }
      await refreshList();
    });
  }

  function handleRename(id: string, name: string) {
    setError(null);
    startTransition(async () => {
      const { error } = await authClient.passkey.updatePasskey({ id, name });
      if (error) {
        setError(error.message ?? "Could not rename passkey");
        return;
      }
      await refreshList();
    });
  }

  return (
    <div className="flex flex-col gap-4 text-base">
      <div className="flex flex-col gap-2">
        {passkeys.length === 0 ? (
          <p className="text-muted-foreground p-4 rounded-md bg-muted text-center text-balance mb-12">
            No passkeys yet. Add a passkey in order to skip the email-OTP flow
            on future sign-ins.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {passkeys.map((p) => (
              <PasskeyRow
                key={p.id}
                passkey={p}
                pending={pending}
                onRename={(name) => handleRename(p.id, name)}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleEnroll();
        }}
        className="flex w-full items-center gap-2"
      >
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={defaultName(passkeys.length)}
          aria-label="Passkey name"
          disabled={pending}
          className="h-11 flex-1"
        />
        <Button type="submit" disabled={pending} size="lg" className="shrink-0">
          <FingerprintSimpleIcon weight="duotone" size={20} />
          Add passkey
        </Button>
      </form>

      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
