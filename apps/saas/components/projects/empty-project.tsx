import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NewProjectButton } from "@/components/new-project-button";
import { PROJECTS_PER_USER_MAX } from "@/lib/project-limits";
import { FolderSimpleDashedIcon } from "@phosphor-icons/react/ssr";

export const EmptyProjects = () => {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderSimpleDashedIcon size={48} weight="light" />
        </EmptyMedia>
        <EmptyTitle>No Projects</EmptyTitle>
        <EmptyDescription className="max-w-xs text-pretty">
          Get started by creating your first project.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/* By definition the user has zero projects in this view, so
            the cap is irrelevant — pass 0 explicitly. */}
        <NewProjectButton projectCount={0} projectMax={PROJECTS_PER_USER_MAX} />
      </EmptyContent>
    </Empty>
  );
};
