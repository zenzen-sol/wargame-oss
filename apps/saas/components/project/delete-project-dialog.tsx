"use client";

// Hard-delete confirmation. Distinct from archive (reversible) — the
// copy spells out that DB rows AND file storage will be wiped, and
// the destructive button is colored so the user can't fat-finger it.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteProject } from "@/lib/actions/projects";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setBusy(true);
    setError("");
    try {
      await deleteProject({ id: projectId });
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogBody className="space-y-6">
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              <strong className="font-medium text-foreground">
                {projectName.trim() || "This project"}
              </strong>{" "}
              and every file, message, issue, and output attached to it will be
              permanently removed. This cannot be undone. Use{" "}
              <em>Archive project</em> if you just want to hide it.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="lg"
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? "Deleting" : "Delete project"}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
