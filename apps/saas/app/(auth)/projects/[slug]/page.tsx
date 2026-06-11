import { ProjectView } from "@/components/project/project-view";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth-session";
import { listConfiguredProviders } from "@/lib/byok";
import { getDraftViewerSources } from "@/lib/queries/draft-viewer";
import {
  getProjectBySlug,
  listFilesForProject,
  listInterviewAnswers,
  listIssuesForProject,
  listMessagesForProject,
  listPartiesForProject,
} from "@/lib/queries/projects";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);

  if (!project) {
    return (
      <>
        <AppChrome breadcrumbs={[{ label: "Not found" }]} />
        <main className="flex w-full flex-1 flex-col gap-6 overflow-y-auto px-6 py-8 lg:px-8">
          <h1>Project not found.</h1>
        </main>
      </>
    );
  }

  const user = await requireUser();
  const [files, parties, answers, messages, issues, configuredProviders] =
    await Promise.all([
      listFilesForProject(project.id),
      listPartiesForProject(project.id),
      listInterviewAnswers(project.id),
      listMessagesForProject(project.id),
      listIssuesForProject(project.id),
      listConfiguredProviders({ userId: user.id }),
    ]);
  // The picker only needs the provider ids; the `is_default` flag
  // is irrelevant inside a project (snapshot is what matters).
  const availableProviders = configuredProviders.map((c) => c.provider);

  // Draft viewer sources — include in-flight proposal versions while
  // the project is still in the debate so the user sees the latest
  // proposal layered on top of the working draft; otherwise show
  // accepted / upload baselines only.
  const includeProposals =
    project.status === "reviewing" || project.status === "negotiating";
  const draftData = await getDraftViewerSources({
    projectId: project.id,
    includeProposals,
  }).catch((err) => {
    console.warn("[project page] getDraftViewerSources failed", err);
    return { sources: [], proposalsByMessageId: {} };
  });

  return (
    <ProjectView
      slug={slug}
      project={project}
      initialFiles={files}
      initialParties={parties}
      initialAnswers={answers}
      initialMessages={messages}
      initialIssues={issues}
      draftSources={draftData.sources}
      draftProposalsByMessageId={draftData.proposalsByMessageId}
      availableProviders={availableProviders}
    />
  );
}
