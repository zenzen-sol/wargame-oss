"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { PowerIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutMenuItem() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handle() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } catch (e) {
      console.error("[auth] signOut threw", e);
    }
    router.push("/sign-in");
  }

  return (
    <DropdownMenuItem
      onClick={handle}
      disabled={signingOut}
      variant="destructive"
    >
      <PowerIcon size={20} />
      {signingOut ? "Signing out" : "Sign out"}
    </DropdownMenuItem>
  );
}
