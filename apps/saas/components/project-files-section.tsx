"use client";

import { FileRow } from "@/components/file-row";
import { ConvertingFileRow } from "@/components/project/converting-file-row";
import { PendingRow } from "@/components/pending-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  attachFile,
  generateFileUpload,
  removeFile,
} from "@/lib/actions/files";
import { featureMultiFileContracts } from "@/lib/feature-flags";
import { DOCX_MIME_TYPE, MAX_FILE_BYTES, formatBytes } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database.types";
import { AnimatePresence, motion } from "framer-motion";
import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { sileo } from "sileo";
import { FileDashedIcon } from "@phosphor-icons/react";
import Link from "next/link";

type ProjectFile = Tables<"files">;

type Rejection = {
  name: string;
  reason: "doc-legacy" | "wrong-extension" | "too-large";
  size?: number;
};

function partitionIncoming(fileList: FileList | File[]): {
  accepted: File[];
  rejected: Rejection[];
} {
  const accepted: File[] = [];
  const rejected: Rejection[] = [];
  for (const f of Array.from(fileList)) {
    const name = f.name.toLowerCase();
    const type = f.type.toLowerCase();
    if (f.size > MAX_FILE_BYTES) {
      rejected.push({ name: f.name, reason: "too-large", size: f.size });
      continue;
    }
    if (name.endsWith(".docx") || type === DOCX_MIME_TYPE) {
      accepted.push(f);
    } else if (name.endsWith(".doc")) {
      rejected.push({ name: f.name, reason: "doc-legacy" });
    } else {
      rejected.push({ name: f.name, reason: "wrong-extension" });
    }
  }
  return { accepted, rejected };
}

interface ProjectFilesSectionProps {
  project: Tables<"projects">;
  files: ProjectFile[];
  /** When false, drop/pick/remove are all suppressed (e.g., post-extraction). */
  disabled?: boolean;
  /** Optional node placed in the footer row beside "Add files".
   *  The Start button rides here so it sits inside the dropzone.
   *  When passed as a function, receives `{ hasPending }` so the
   *  caller can disable the action while uploads are in flight. */
  trailingAction?: ReactNode | ((state: { hasPending: boolean }) => ReactNode);
  /** Fires when the in-flight upload count changes from zero to non-
   *  zero (or back). Used by FilePhaseBody to drop the provider
   *  picker the instant a user starts uploading — before the file
   *  row makes it back to SSR — so the layout settles cleanly. */
  onPendingChange?: (hasPending: boolean) => void;
  /** When true, the dropzone runs a two-phase exit:
   *  1. Content (file card, toolbar, trailing UI) fades out.
   *  2. Dashed border scales beyond the viewport and fades.
   *  Used by SceneBody to choreograph the extracting → setup
   *  handoff. Disables layout animations while exiting so they
   *  don't fight the scale tween. */
  exiting?: boolean;
  /** True when a ProviderPicker will render directly below the
   *  dropzone. Controls two things in the empty state:
   *   - Disclaimer copy mentions "select below" only when there's
   *     actually a selector below.
   *   - The empty box keeps `flex-1` to anchor the column;
   *     single-key users (no picker) get natural height so the
   *     vertical area shrinks to the content + parent's
   *     justify-center centers it. */
  pickerBelow?: boolean;
}

type Pending = { localId: string; name: string; fileId?: string };

// Motion constants — declared above the component so Turbopack
// Fast Refresh can't re-execute the component against a partially-
// initialized module (which produced `ReferenceError: EMPTY_EXIT
// is not defined` on 2026-05-17).
//
// The dashed-border morph needs to feel deliberate but quick — a
// softer spring than the AI-keys tabs' indicator and a faster fade
// than the chrome menu. Tweak in one place.
const LAYOUT_SPRING = {
  type: "spring" as const,
  stiffness: 260,
  damping: 32,
  mass: 0.8,
};
const FADE_FAST = { duration: 0.16, ease: "easeOut" as const };
// Three-beat empty→list sequence: empty fades out, dropzone
// shrinks, row + Start fade in. Tuned so each beat reads as its
// own event — no two opacity/scale changes overlap.
const EMPTY_EXIT_MS = 180;
const EMPTY_EXIT = {
  duration: EMPTY_EXIT_MS / 1000,
  ease: "easeOut" as const,
};
const ROW_ENTER = {
  opacity: { duration: 0.22, ease: "easeOut" as const, delay: 0.36 },
};

export function ProjectFilesSection({
  project,
  files,
  disabled = false,
  trailingAction,
  onPendingChange,
  exiting = false,
  pickerBelow = false,
}: ProjectFilesSectionProps) {
  // Each in-flight upload gets a localId. We DON'T clear pending
  // entries when attachFile resolves — there's a render gap between
  // the action returning and Next's RSC payload arriving with the
  // new file row, and clearing too early causes the dropzone to
  // flash back to the empty state. Instead we derive visible-pending
  // during render: an entry stays visible until its `fileId` shows
  // up in the `files` prop.
  const [pending, setPending] = useState<Pending[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const editable = !disabled;

  const knownFileIds = new Set(files.map((f) => f.id));
  const visiblePending = pending.filter(
    (p) => !p.fileId || !knownFileIds.has(p.fileId),
  );
  // Drop fully-claimed entries on the next render — works without an
  // effect because `pending` itself derives nothing async-side. We
  // only mutate state when the array truly shrinks.
  if (visiblePending.length !== pending.length && pending.length > 0) {
    queueMicrotask(() => setPending(visiblePending));
  }

  const multiFileEnabled = featureMultiFileContracts.publicEnabled();
  // When the multi-file flag is off, every project is capped at one
  // file — never show "Add more files" once a slot is taken (or even
  // while an upload is in flight, to avoid a transient flash).
  const canAddMore = multiFileEnabled;

  const handleUpload = useCallback(
    async (incoming: File[]) => {
      if (!editable) return;
      // Multi-file gate: silently keep only the first accepted file
      // when the flag is off. Direct server actions also enforce
      // this — the client guard is just for UX.
      const limited = multiFileEnabled ? incoming : incoming.slice(0, 1);
      const { accepted, rejected } = partitionIncoming(limited);

      const tooLarge = rejected.filter((r) => r.reason === "too-large");
      const legacy = rejected.filter((r) => r.reason === "doc-legacy");
      const other = rejected.filter((r) => r.reason === "wrong-extension");

      if (tooLarge.length > 0) {
        const names = tooLarge.map((r) => r.name).join(", ");
        sileo.error({
          title:
            tooLarge.length === 1 ? "File is too large" : "Files are too large",
          description: `The limit is ${formatBytes(MAX_FILE_BYTES)}. Skipped: ${names}`,
        });
      }
      if (legacy.length > 0) {
        const names = legacy.map((r) => r.name).join(", ");
        sileo.error({
          title:
            legacy.length === 1 ? "Unsupported format" : "Unsupported formats",
          description: `Only .docx is supported. Save ${names} as .docx and try again.`,
        });
      }
      if (other.length > 0) {
        const names = other.map((r) => r.name).join(", ");
        sileo.error({
          title:
            other.length === 1 && other[0]
              ? `Can't add ${other[0].name}`
              : "Can't add these files",
          description:
            other.length === 1
              ? "Only .docx files are supported."
              : `Only .docx files are supported. Skipped: ${names}`,
        });
      }

      if (accepted.length === 0) return;

      const pairs = accepted.map((file) => ({
        file,
        pending: { localId: crypto.randomUUID(), name: file.name } as Pending,
      }));
      setPending((prev) => [...prev, ...pairs.map((p) => p.pending)]);
      const supabase = createClient();
      await Promise.all(
        pairs.map(async ({ file, pending }) => {
          const localId = pending.localId;
          try {
            const { fileId, storageKey, token } = await generateFileUpload({
              projectId: project.id,
              name: file.name,
              mimeType: file.type || DOCX_MIME_TYPE,
              byteSize: file.size,
            });
            // Bind the upload's localId to the fileId so the cleanup
            // pass can match it against the `files` prop.
            setPending((prev) =>
              prev.map((p) => (p.localId === localId ? { ...p, fileId } : p)),
            );
            const { error: uploadError } = await supabase.storage
              .from("project-files")
              .uploadToSignedUrl(storageKey, token, file, {
                contentType: file.type || DOCX_MIME_TYPE,
              });
            if (uploadError) throw uploadError;
            await attachFile({ fileId });
          } catch (err) {
            console.error("[files] upload failed", err);
            sileo.error({
              title: `Failed to add ${file.name}`,
              description: err instanceof Error ? err.message : "Upload failed",
            });
            // Failed entries don't get a fileId, so they'd be stuck
            // visible. Drop them explicitly.
            setPending((prev) => prev.filter((p) => p.localId !== localId));
          }
        }),
      );
    },
    [editable, project.id, multiFileEnabled],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (!editable) return;
      handleUpload(Array.from(e.dataTransfer.files));
    },
    [editable, handleUpload],
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (editable) setIsDragOver(true);
    },
    [editable],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handlePick = useCallback(() => inputRef.current?.click(), []);

  const handleRemove = useCallback(async (fileId: string) => {
    try {
      await removeFile({ fileId });
    } catch (err) {
      console.error("[files] remove failed", err);
      sileo.error({
        title: "Failed to remove file",
        description: err instanceof Error ? err.message : "Remove failed",
      });
    }
  }, []);

  const isEmpty = files.length === 0 && visiblePending.length === 0;
  const hasPending = visiblePending.length > 0;

  // Arm the row-entrance fade only when the list transitions FROM
  // an empty state during this client session. On a hard reload of
  // a project that already has files, we want the rows to be there
  // immediately — no 600ms delayed fade after hydration.
  const entranceArmedRef = useRef(false);
  if (isEmpty) entranceArmedRef.current = true;
  const animateRowEntrance = entranceArmedRef.current;

  // The empty→list handoff is a three-beat sequence:
  //   1. Empty content fades out (EMPTY_EXIT_MS)
  //   2. Dropzone layout spring shrinks the dashed box
  //   3. Row + Start button fade in (ROW_ENTER)
  // To keep beats 1 and 2 from overlapping (which would make the
  // CTA appear to scale-shrink as it fades), the parent's height
  // classes are driven by a local `phase` that lags `isEmpty` by
  // EMPTY_EXIT_MS on the empty→list direction. The reverse (list →
  // empty, e.g. removeFile of the last file) flips instantly.
  const [phase, setPhase] = useState<"empty" | "list">(
    isEmpty ? "empty" : "list",
  );
  const exitingEmpty = phase === "empty" && !isEmpty;
  useEffect(() => {
    if (isEmpty && phase === "list") {
      setPhase("empty");
    } else if (!isEmpty && phase === "empty") {
      const t = setTimeout(() => setPhase("list"), EMPTY_EXIT_MS);
      return () => clearTimeout(t);
    }
  }, [isEmpty, phase]);

  // Bubble the in-flight upload signal up so the parent can hide
  // the provider picker the instant a user picks a file (before the
  // SSR file row arrives). We intentionally don't memoize the
  // callback — it's the parent's responsibility to keep its
  // identity stable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: callback identity is parent's problem.
  useEffect(() => {
    onPendingChange?.(hasPending);
  }, [hasPending]);

  return (
    <motion.div
      // Disable layout morphing during exit: the scale tween below
      // owns the geometry, and layout would fight it.
      layout={!exiting}
      animate={exiting ? { scale: 8, opacity: 0 } : undefined}
      transition={
        exiting
          ? {
              // Hold full size while the content fades (≈230ms), then
              // expand for ≈520ms. Ease-in on the scale so the
              // expansion accelerates outward like a release.
              scale: {
                delay: 0.23,
                duration: 0.52,
                ease: [0.55, 0, 0.75, 0.2],
              },
              opacity: { delay: 0.23, duration: 0.52, ease: "easeOut" },
            }
          : LAYOUT_SPRING
      }
      style={{ transformOrigin: "center" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "group/dropzone",
        "w-auto",
        "border-3",
        "border-dashed",
        "rounded-2xl",
        "px-8",
        "w-full",
        "flex",
        "flex-col",
        "justify-center",
        // Empty with picker below: fill the available vertical
        // space so the dashed box reads as the primary CTA area
        // and the picker rides at the bottom of the column.
        // Empty without picker: natural height; parent's
        // justify-center centers the whole stack so a single-key
        // user doesn't see a massive empty box.
        // Non-empty: shrinks to its content; centered horizontally
        // by mx-auto + the narrower max-width.
        phase === "empty"
          ? pickerBelow
            ? "py-24 flex-1"
            : "py-16 h-full"
          : "py-8 max-w-prose mx-auto",
        isDragOver && "border-accent bg-accent/5",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        {...(multiFileEnabled ? { multiple: true } : {})}
        className="hidden"
        onChange={(e) => {
          if (!e.target.files) return;
          handleUpload(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {/*
        No outer empty↔list AnimatePresence: the dropzone's own
        `layout` spring is the entrance animation. When the user
        drops a file, the dashed box shrinks to wrap the new card —
        layering an opacity fade on top of that made the row read as
        "fade in + scale down" because the freshly-mounted list
        inherited the parent's mid-spring height transform before it
        had its own layout snapshot. Emil-style: one motion serves
        the narrative — don't stack a fade on top of a layout morph.
       */}
      {phase === "empty" ? (
        <motion.div
          initial={false}
          animate={{ opacity: exitingEmpty ? 0 : 1 }}
          transition={EMPTY_EXIT}
          className="flex flex-col items-center gap-3"
        >
          <div className="flex flex-col items-center gap-1">
            <FileDashedIcon size={42} weight="light" />
            <span className="font-medium">Add contract file</span>
            <span className="text-muted-foreground/70 text-balance text-center text-sm">
              Upload a Microsoft Word (.docx) file to start.
            </span>
          </div>
          <div className="flex items-center gap-3 mt-6">
            <Dialog>
              <DialogTrigger render={<Button variant="outline" size="lg" />}>
                On data handling
              </DialogTrigger>
              <DialogContent className="p-12">
                <DialogHeader>
                  <DialogTitle className="text-base">
                    On data security and confidentiality
                  </DialogTitle>
                </DialogHeader>
                <DialogBody className="text-base text-muted-foreground gap-3">
                  <p className="text-pretty">
                    Your file will be stored in{" "}
                    <Link
                      href="https://supabase.com/security"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground underline underline-offset-4 decoration-dotted hover:text-foreground"
                    >
                      secure file storage
                    </Link>
                    . Some contract language will be shared with your configured
                    AI provider
                    {pickerBelow ? "s" : null}, but only as required to carry
                    out your requests.
                  </p>
                  <p className="text-pretty">
                    Your AI provider account has a setting to prevent use of
                    your data when training models. Consider opting out before
                    uploading sensitive information.
                  </p>
                  <p className="text-pretty">
                    While thoughtful measures are taken to secure your files and
                    data, think carefully before submitting anything that should
                    remain privileged or confidential.
                  </p>
                </DialogBody>
              </DialogContent>
            </Dialog>
            <Button size="lg" onClick={handlePick} disabled={!editable}>
              Upload file
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          layout={!exiting ? "position" : false}
          animate={exiting ? { opacity: 0 } : undefined}
          transition={
            exiting ? { duration: 0.22, ease: "easeIn" } : LAYOUT_SPRING
          }
          className="flex flex-col gap-2"
        >
          <AnimatePresence initial={animateRowEntrance} mode="popLayout">
            {files.map((file) => (
              <motion.div
                key={file.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={ROW_ENTER}
              >
                {file.conversion_status === "pending" ? (
                  <ConvertingFileRow file={file} editable={editable} />
                ) : (
                  <FileRow
                    file={file}
                    editable={editable}
                    onRemove={() => handleRemove(file.id)}
                  />
                )}
              </motion.div>
            ))}
            {visiblePending.map((p) => (
              <motion.div
                key={p.localId}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={ROW_ENTER}
              >
                <PendingRow name={p.name} />
              </motion.div>
            ))}
          </AnimatePresence>
          {/*
            Toolbar stays mounted across the whole file phase so the
            morphing trailing action (Start → Starting → Reading the
            contract) remains visible while the run is locked. "Add
            files" is what we hide when locked, not the entire row.
          */}
          {(editable || trailingAction) && (
            <motion.div
              layout="position"
              initial={animateRowEntrance ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{
                layout: LAYOUT_SPRING,
                opacity: ROW_ENTER.opacity,
              }}
              className="flex items-center justify-between gap-6 pt-6"
            >
              {editable && canAddMore ? (
                <Button type="button" variant="link" onClick={handlePick}>
                  Add more files
                </Button>
              ) : (
                <div />
              )}
              {typeof trailingAction === "function"
                ? trailingAction({ hasPending })
                : trailingAction}
            </motion.div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// Springs are kept here (not pulled from a shared util) because the
