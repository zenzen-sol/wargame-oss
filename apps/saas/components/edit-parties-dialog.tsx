"use client";

// Full-canvas dialog for cleaning up the AI-extracted party list.
// Used as a side trip from the main SetupForm — the user opens
// this when the extraction got something wrong (typo'd name,
// missing party, extra party). Edits are staged locally and only
// commit on Save.

import { EditPartiesColumnHeader } from "@/components/edit-parties-column-header";
import { type DraftRow, EditRow } from "@/components/edit-row";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog";
import {
  addPartyToSide,
  removeParty,
  updatePartyName,
  updatePartyRole,
} from "@/lib/actions/parties";
import type { Tables } from "@/types/database.types";
import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

type Party = Tables<"project_parties">;

function snapshot(parties: Party[]): DraftRow[] {
  return parties.map((p) => ({
    id: p.id,
    isNew: false,
    side: p.side,
    role: p.role ?? "",
    name: p.name ?? "",
  }));
}

function nextTempId(): string {
  return `temp-${crypto.randomUUID()}`;
}

export function EditPartiesDialog({
  open,
  onOpenChange,
  parties,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parties: Party[];
  projectId: string;
}) {
  // Re-snapshot whenever the dialog opens so a closed-and-reopened
  // session reflects the current server state. While open the
  // draft is the source of truth (Realtime updates ignored).
  const [draft, setDraft] = useState<DraftRow[]>(() => snapshot(parties));
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [snapshotKey, setSnapshotKey] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by snapshotKey
  const originalById = useMemo(() => {
    const map = new Map<string, Party>();
    for (const p of parties) map.set(p.id, p);
    return map;
  }, [snapshotKey]);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Fresh snapshot on open.
      setDraft(snapshot(parties));
      setRemovedIds(new Set());
      setErrorMessage("");
      setSnapshotKey((k) => k + 1);
    } else if (isDirty && !saving) {
      if (!confirm("Discard unsaved party edits?")) return;
    }
    onOpenChange(next);
  }

  const isDirty = useMemo(() => {
    if (removedIds.size > 0) return true;
    for (const row of draft) {
      if (row.isNew) return true;
      const orig = originalById.get(row.id);
      if (!orig) return true;
      if ((orig.role ?? "") !== row.role) return true;
      if ((orig.name ?? "") !== row.name) return true;
    }
    return false;
  }, [draft, removedIds, originalById]);

  function patchRow(id: string, patch: Partial<DraftRow>) {
    setDraft((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function handleRemove(id: string) {
    setDraft((prev) => prev.filter((r) => r.id !== id));
    setRemovedIds((prev) => {
      if (id.startsWith("temp-")) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function handleAdd() {
    const nextSide =
      draft.length === 0 ? 0 : Math.max(...draft.map((r) => r.side)) + 1;
    setDraft((prev) => [
      ...prev,
      {
        id: nextTempId(),
        isNew: true,
        side: nextSide,
        role: "",
        name: "",
      },
    ]);
  }

  async function handleSave() {
    setSaving(true);
    setErrorMessage("");
    try {
      // Apply in deterministic order: deletions first, then creates,
      // then updates. Errors short-circuit and surface to the user.
      for (const id of removedIds) {
        await removeParty({ id });
      }
      for (const row of draft) {
        if (row.isNew) {
          const created = await addPartyToSide({
            projectId,
            side: row.side,
            role: row.role.trim() || undefined,
          });
          if (row.name.trim().length > 0) {
            await updatePartyName({ id: created.id, name: row.name });
          }
          continue;
        }
        const orig = originalById.get(row.id);
        if (!orig) continue;
        if ((orig.role ?? "") !== row.role && row.role.trim().length > 0) {
          await updatePartyRole({ id: row.id, role: row.role });
        }
        if ((orig.name ?? "") !== row.name && row.name.trim().length > 0) {
          await updatePartyName({ id: row.id, name: row.name });
        }
      }
      onOpenChange(false);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not save.");
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="p-12">
        <DialogBody>
          <div className="flex flex-col">
            <EditPartiesColumnHeader />
            <div className="flex w-full flex-col gap-3">
              {draft.map((row) => (
                <EditRow
                  key={row.id}
                  row={row}
                  disabled={saving}
                  onChangeRole={(role) => patchRow(row.id, { role })}
                  onChangeName={(name) => patchRow(row.id, { name })}
                  onRemove={() => handleRemove(row.id)}
                />
              ))}
              {draft.length === 0 && (
                <p className="px-3 py-2.5 text-muted-foreground">
                  No parties. Click Add party to create one.
                </p>
              )}
            </div>
          </div>

          {/* Action cluster sits beneath the inputs in flow — the
              user's eye lands on Save right where the form ends.
              No separate dialog footer. */}
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
              size="lg"
            >
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleAdd}
                disabled={saving}
                size="lg"
              >
                <PlusIcon className="size-4" weight="bold" />
                <span>Add party</span>
              </Button>
              <Button
                onClick={handleSave}
                disabled={!isDirty || saving}
                size="lg"
              >
                {saving ? "Saving" : "Save"}
              </Button>
            </div>
          </div>

          {errorMessage && (
            <p className="text-right text-destructive">{errorMessage}</p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
