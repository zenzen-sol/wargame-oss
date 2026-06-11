import { Shimmer } from "@/components/ai-elements/shimmer";
import { AppChrome } from "@/components/shell/app-chrome";

// Next.js streams this while the server component's data fetches
// resolve. Replaces the dead "loading" branch the old deriveScene
// had (which never fired — by the time ProjectView mounts, the
// page has already awaited the project).

export default function ProjectLoading() {
  return (
    <>
      <AppChrome
        breadcrumbs={[
          { label: "Projects" },
          { label: <Shimmer>Loading</Shimmer> },
        ]}
      />
    </>
  );
}
