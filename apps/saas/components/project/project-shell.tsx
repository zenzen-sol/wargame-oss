"use client";

import type { DraftViewerSourceData } from "@/lib/queries/draft-viewer";
import { IssuesSheet } from "@/components/issues/issues-sheet";
import { DeleteProjectDialog } from "@/components/project/delete-project-dialog";
import { EditableTitle } from "@/components/project/editable-title";
import { ProjectHeader } from "@/components/project/project-header";
import { SceneBody } from "@/components/project/scene-body";
import { AppChrome } from "@/components/shell/app-chrome";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { startExtraction } from "@/lib/actions/extraction";
import type { Provider } from "@/lib/actions/onboarding";
import {
  archiveProject,
  renameProject,
  requestCancel,
  retryExtraction,
} from "@/lib/actions/projects";
import { type Scene, sceneUsesTranscript } from "@/lib/project-scene";
import { useProjectRealtime } from "@/lib/use-project-realtime";
import type { Tables } from "@/types/database.types";
import { ArchiveIcon, TrashIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Project = Tables<"projects">;
type Party = Tables<"project_parties">;
type FileRow = Tables<"files">;
type AnswerRow = Tables<"interview_answers">;
type MessageRow = Tables<"messages">;
type IssueRow = Tables<"issues">;

export interface ProjectShellProps {
  slug: string;
  scene: Scene;
  project: Project;
  files: FileRow[];
  parties: Party[];
  answers: AnswerRow[];
  messages: MessageRow[];
  issues: IssueRow[];
  draftSources: DraftViewerSourceData[];
  draftProposalsByMessageId: Record<string, DraftViewerSourceData>;
  availableProviders: Provider[];
}

export function ProjectShell({
  slug,
  scene,
  project,
  files,
  parties,
  answers,
  messages,
  issues,
  draftSources,
  draftProposalsByMessageId,
  availableProviders,
}: ProjectShellProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Bridge to the chat instance owned by TranscriptShell. handleStop
  // needs to abort the in-flight POST before requestCancel flips the
  // DB status; without this, useChat keeps streaming until the model
  // finishes naturally and the cancel doesn't feel honest.
  const chatStopRef = useRef<(() => void) | null>(null);

  // Issues live in a Sheet now (was a 4th column; broke the
  // carefully-tuned 3-column transcript). The status bar's progress
  // text is the trigger.
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // When the user clicks an issue link in the transcript, we want
  // the sheet to open AND scroll to that issue. Track the requested
  // target so the sheet can react after its open animation settles.
  const [issueTarget, setIssueTarget] = useState<{
    id: string;
    /** monotonic so re-clicking the same issue still triggers a scroll */
    nonce: number;
  } | null>(null);
  const openIssue = (id: string) => {
    setIssueTarget({ id, nonce: Date.now() });
    setIssuesOpen(true);
  };
  const sceneSurfacesIssues =
    scene.kind === "live" ||
    scene.kind === "live-failed" ||
    scene.kind === "completed" ||
    scene.kind === "cancelled";

  // Subscribe to all project-scoped tables; on any change, ask the
  // server to revalidate the path. Next streams fresh server-component
  // output to the client. This is the Convex-reactive-query
  // replacement — Supabase Realtime + revalidatePath.
  useProjectRealtime(project.id, slug);

  // Once the scene leaves draft (we're in extracting / etc.), the
  // local "starting" optimistic flag has done its job and the new
  // scene is the source of truth. Drop it so a future return to
  // file-setup (e.g., extraction-failed → retry → draft) doesn't
  // arrive with a stale lock.
  useEffect(() => {
    if (scene.kind !== "file-setup" && starting) {
      setStarting(false);
    }
  }, [scene.kind, starting]);

  async function commitTitle(next: string) {
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === project.name) {
      setEditing(false);
      return;
    }
    try {
      await renameProject({ id: project.id, name: trimmed });
      setEditing(false);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Rename failed");
    }
  }

  async function handleArchive() {
    if (!confirm("Archive this project? It will be hidden from your list.")) {
      return;
    }
    try {
      await archiveProject({ id: project.id });
      router.push("/");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Archive failed");
    }
  }

  async function handleStart() {
    setStarting(true);
    setErrorMessage("");
    try {
      await startExtraction({ projectId: project.id });
      // Don't reset `starting` on success. The scene transitions to
      // `extracting` via Realtime+revalidatePath, and FileSetupBody
      // unmounts (ExtractingBody renders instead). Resetting here
      // would create a flicker window where the Start button looks
      // re-enabled before the new scene paints.
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : "Could not start extraction.",
      );
      setStarting(false);
    }
  }

  async function handleRetryExtraction() {
    setRetrying(true);
    setErrorMessage("");
    try {
      await retryExtraction({ projectId: project.id });
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not retry.");
    } finally {
      setRetrying(false);
    }
  }

  async function handleStop() {
    if (
      !confirm(
        "Stop the run? In-flight turns will end and the project will be marked cancelled. You can archive it or start a new project afterward.",
      )
    ) {
      return;
    }
    setErrorMessage("");
    // Abort the in-flight chat POST first — chat.stop() resolves
    // immediately and tears down the SSE stream client-side. The
    // server-side `streamText` sees the abort signal and stops
    // billing the model. Then flip DB status.
    chatStopRef.current?.();
    try {
      await requestCancel({ projectId: project.id });
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not stop.");
    }
  }

  const useTranscriptLayout = sceneUsesTranscript(scene);
  const mainClass = useTranscriptLayout
    ? "flex min-h-0 w-full flex-1 flex-col gap-6 px-6 pb-6 lg:px-8"
    : "flex w-full flex-1 flex-col gap-6 overflow-y-auto px-6 pb-8 lg:px-8";

  // Stop is meaningful only once the agents are actually running
  // (`live`). During `extracting` the run is short, server-side, and
  // not really cancellable in a useful way — surfacing the button
  // there just shifted the header layout for no benefit.
  const isStoppable = scene.kind === "live";

  return (
    <>
      <AppChrome
        breadcrumbs={[
          { label: "Projects", href: "/" },
          {
            label: project.name,
            node: (
              <EditableTitle
                value={project.name}
                editing={editing}
                onStartEdit={() => setEditing(true)}
                onCancel={() => setEditing(false)}
                onCommit={commitTitle}
              />
            ),
          },
        ]}
        actions={
          <>
            <DropdownMenuItem onClick={handleArchive}>
              <ArchiveIcon size={20} />
              <span>Archive project</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDeleteOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon size={20} />
              <span>Delete project</span>
            </DropdownMenuItem>
          </>
        }
      />
      <main className={mainClass}>
        <ProjectHeader
          project={project}
          scene={scene}
          errorMessage={errorMessage}
          isStoppable={isStoppable}
          onStop={handleStop}
          onPartsClick={
            sceneSurfacesIssues ? () => setIssuesOpen(true) : undefined
          }
        />
        <DeleteProjectDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          projectId={project.id}
          projectName={project.name}
        />
        {sceneSurfacesIssues && (
          <IssuesSheet
            open={issuesOpen}
            onOpenChange={setIssuesOpen}
            issues={issues}
            projectId={project.id}
            interactive={scene.kind === "live"}
            target={issueTarget}
          />
        )}
        <SceneBody
          scene={scene}
          files={files}
          parties={parties}
          answers={answers}
          messages={messages}
          issues={issues}
          starting={starting}
          retrying={retrying}
          onStart={handleStart}
          onRetryExtraction={handleRetryExtraction}
          chatStopRef={chatStopRef}
          onOpenIssue={openIssue}
          draftSources={draftSources}
          draftProposalsByMessageId={draftProposalsByMessageId}
          availableProviders={availableProviders}
        />
      </main>
    </>
  );
}
