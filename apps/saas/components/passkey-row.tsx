"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckIcon,
  FingerprintSimpleIcon,
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

export type Passkey = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
};

export function PasskeyRow({
  passkey,
  pending,
  onRename,
  onDelete,
}: {
  passkey: Passkey;
  pending: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const displayName = passkey.name?.trim() || "Unnamed passkey";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === displayName) {
      setDraft(displayName);
      return;
    }
    onRename(next);
  }

  return (
    <li className="group flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <FingerprintSimpleIcon
          weight="duotone"
          size={20}
          className="shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
              className="flex items-center gap-2"
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setDraft(displayName);
                    setEditing(false);
                  }
                }}
                aria-label="Passkey name"
                disabled={pending}
                autoFocus
                className="h-8 flex-1"
              />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label="Save"
              >
                <CheckIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setDraft(displayName);
                  setEditing(false);
                }}
                aria-label="Cancel"
              >
                <XIcon className="size-4" />
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(displayName);
                setEditing(true);
              }}
              className="flex items-center gap-2 text-left font-medium hover:underline decoration-dotted underline-offset-2"
              title="Rename passkey"
            >
              <span className="truncate">{displayName}</span>
              <PencilSimpleIcon
                size={12}
                weight="bold"
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 group-focus-within:opacity-70"
                aria-hidden
              />
            </button>
          )}
          <span className="text-muted-foreground">
            {passkey.deviceType} ·{" "}
            {passkey.backedUp ? "synced" : "device-bound"}
          </span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending || editing}
        onClick={onDelete}
        aria-label="Delete passkey"
      >
        <TrashIcon className="size-4" />
      </Button>
    </li>
  );
}
