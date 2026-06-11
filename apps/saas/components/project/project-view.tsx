"use client";

import type { DraftViewerSourceData } from "@/lib/queries/draft-viewer";
import { ProjectShell } from "@/components/project/project-shell";
import type { Provider } from "@/lib/actions/onboarding";
import { deriveScene } from "@/lib/project-scene";
import type { Tables } from "@/types/database.types";

type Project = Tables<"projects">;
type Party = Tables<"project_parties">;
type FileRow = Tables<"files">;
type AnswerRow = Tables<"interview_answers">;
type MessageRow = Tables<"messages">;
type IssueRow = Tables<"issues">;

export function ProjectView({
  slug,
  project,
  initialFiles,
  initialParties,
  initialAnswers,
  initialMessages,
  initialIssues,
  draftSources,
  draftProposalsByMessageId,
  availableProviders,
}: {
  slug: string;
  project: Project;
  initialFiles: FileRow[];
  initialParties: Party[];
  initialAnswers: AnswerRow[];
  initialMessages: MessageRow[];
  initialIssues: IssueRow[];
  draftSources: DraftViewerSourceData[];
  draftProposalsByMessageId: Record<string, DraftViewerSourceData>;
  availableProviders: Provider[];
}) {
  const scene = deriveScene({
    project,
    files: initialFiles,
    parties: initialParties,
    messages: initialMessages,
    issues: initialIssues,
  });

  return (
    <ProjectShell
      slug={slug}
      scene={scene}
      project={project}
      files={initialFiles}
      parties={initialParties}
      answers={initialAnswers}
      messages={initialMessages}
      issues={initialIssues}
      draftSources={draftSources}
      draftProposalsByMessageId={draftProposalsByMessageId}
      availableProviders={availableProviders}
    />
  );
}
