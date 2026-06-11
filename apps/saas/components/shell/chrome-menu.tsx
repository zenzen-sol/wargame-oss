"use client";

import { SignOutMenuItem } from "@/components/shell/sign-out-menu-item";
import { ThemeMenu } from "@/components/shell/theme-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FingerprintSimpleIcon,
  KeyIcon,
  ListIcon,
  NotepadIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";

// Dev-only convenience: the interest poll is normally entered via the
// "Why these limits?" link on the setup form. In dev we surface it in
// the chrome menu so we can review it without spinning up a project.
const IS_DEV = process.env.NODE_ENV === "development";

export function ChromeMenu({ children }: { children?: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Open menu"
            className="text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:text-accent"
          >
            <ListIcon weight="bold" size={24} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {children && (
          <>
            {children}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          render={
            <Link href="/settings/api-keys">
              <KeyIcon size={20} />
              <span>API keys</span>
            </Link>
          }
        />
        <DropdownMenuItem
          render={
            <Link href="/settings/passkeys">
              <FingerprintSimpleIcon size={20} />
              <span>Passkeys</span>
            </Link>
          }
        />
        {IS_DEV && (
          <DropdownMenuItem
            render={
              <Link href="/poll">
                <NotepadIcon size={20} />
                <span>Poll</span>
              </Link>
            }
          />
        )}
        <ThemeMenu />
        <DropdownMenuSeparator />
        <SignOutMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
