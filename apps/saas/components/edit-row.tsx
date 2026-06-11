"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TrashIcon } from "@phosphor-icons/react";

export interface DraftRow {
  /** Server id, or `temp-*` for rows added in this dialog session. */
  id: string;
  /** True if this row was added locally and hasn't been persisted yet. */
  isNew: boolean;
  /** Original side number for existing rows; for new ones, the side
   *  we'll use when calling addPartyToSide. */
  side: number;
  role: string;
  name: string;
}

export function EditRow({
  row,
  disabled,
  onChangeRole,
  onChangeName,
  onRemove,
}: {
  row: DraftRow;
  disabled: boolean;
  onChangeRole: (role: string) => void;
  onChangeName: (name: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group/party flex items-center gap-3">
      <Input
        value={row.role}
        placeholder="Role"
        aria-label="Party role"
        autoFocus={row.side === 0}
        disabled={disabled}
        onChange={(e) => onChangeRole(e.target.value)}
        className="h-11 w-50 font-medium bg-background"
      />
      <Input
        value={row.name}
        placeholder="Name"
        aria-label="Party name"
        disabled={disabled}
        onChange={(e) => onChangeName(e.target.value)}
        className="h-11 min-w-0 flex-1 font-medium bg-background"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${row.name || row.role || "party"}`}
        title="Remove party"
        className={cn(
          "flex w-8 shrink-0 items-center justify-center",
          "text-muted-foreground transition-colors hover:text-destructive",
          "disabled:opacity-50",
          "focus-visible:text-destructive",
          "focus-visible:outline-none",
          "focus-visible:ring-0",
        )}
      >
        <TrashIcon size={20} />
      </button>
    </div>
  );
}
