import { NewProjectButton } from "@/components/new-project-button";
import { EmptyProjects } from "@/components/projects/empty-project";
import { ProjectTable } from "@/components/projects/project-table";
import { AppChrome } from "@/components/shell/app-chrome";
import { PROJECTS_PER_USER_MAX } from "@/lib/project-limits";
import { listProjectsForUser } from "@/lib/queries/projects";

export default async function HomePage() {
  const projects = await listProjectsForUser();

  return (
    <>
      <AppChrome breadcrumbs={[{ label: "Projects", href: "/" }]} />
      <main className="flex w-full flex-1 flex-col gap-6 overflow-y-auto px-6 py-8 lg:px-8">
        {projects.length === 0 ? (
          <EmptyProjects />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground">
                {projects.length} project{projects.length === 1 ? "" : "s"}
              </p>
              <NewProjectButton
                projectCount={projects.length}
                projectMax={PROJECTS_PER_USER_MAX}
              />
            </div>
            <ProjectTable projects={projects} />
          </>
        )}
      </main>
    </>
  );
}
