"use client";

import { Button } from "@/components/ui/button";
import { createProject } from "@/lib/actions/projects";
import { PlusIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { sileo } from "sileo";

interface Props {
  /** Current count of non-archived projects the user owns. When at
   *  or above `projectMax`, the button is disabled with a
   *  tooltip-style hint instead of letting the user click into a
   *  guaranteed error. */
  projectCount: number;
  /** Per-user cap, resolved on the server (env-driven). Passed in
   *  rather than imported so server and client agree during
   *  hydration — `process.env.PROJECTS_PER_USER_MAX` isn't exposed
   *  to the browser bundle. */
  projectMax: number;
}

export function NewProjectButton({ projectCount, projectMax }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const atCap = projectCount >= projectMax;

  function handleClick() {
    if (atCap) return;
    startTransition(async () => {
      try {
        const { slug } = await createProject();
        router.push(`/projects/${slug}`);
      } catch (e) {
        // Surface the server's specific message (e.g. the cap error
        // copy from createProject) rather than swallowing it under a
        // generic string. The cap is pre-checked above, so this
        // path catches races or direct action calls.
        const description =
          e instanceof Error ? e.message : "Failed to create project.";
        console.error("[projects] create failed", e);
        sileo.error({ title: "Couldn't create project", description });
      }
    });
  }

  // The native `title` attribute is enough for "why is this
  // disabled?" — no need for a heavier tooltip primitive here.
  const disabledHint = atCap
    ? `You've reached the ${projectMax}-project limit. Archive or delete a project to create another.`
    : undefined;

  return (
    <Button
      onClick={handleClick}
      size="lg"
      disabled={pending || atCap}
      title={disabledHint}
      aria-describedby={atCap ? "new-project-cap" : undefined}
    >
      <PlusIcon className="size-4" />
      <span>New Project</span>
      {atCap && (
        <span id="new-project-cap" className="sr-only">
          {disabledHint}
        </span>
      )}
    </Button>
  );
}
