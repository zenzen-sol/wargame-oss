"use server";
// Single action for the new SetupForm: writes party sides, draft
// ownership, both interview answers, and flips the project status
// straight to `reviewing` so the agents start. Replaces the old
// split (confirmParties + setDraftOwnership + upsertInterviewAnswer
// × 2 + startReview) that the multi-step walkthrough relied on.

import { requireUserWithDisclaimer } from "@/lib/auth-session";
import {
  MAX_ISSUES_CAP,
  MAX_TURNS_PER_ISSUE_CAP,
  MIN_ISSUES,
  MIN_TURNS_PER_ISSUE,
  clampToCap,
} from "@/lib/limits";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type DraftOwnership = "ours" | "theirs" | "neither";

export async function submitSetup(input: {
  projectId: string;
  userPartyIds: string[];
  draftOwnership: DraftOwnership;
  userSideDetails: string;
  counterpartyDetails: string;
  maxIssues: number;
  maxTurnsPerIssue: number;
}): Promise<void> {
  // submitSetup transitions the project out of draft and locks in
  // run parameters; treat as substantive use of the product and
  // require disclaimer ack.
  await requireUserWithDisclaimer();
  const supabase = await createClient();

  // Clamp cost-affecting numeric inputs. The form exposes the same
  // caps, but a malicious client can POST any number — this is the
  // trusted boundary. Out-of-range values come back as a near-cap,
  // not an error, so the UX doesn't break when a stale form posts
  // an old default. Unset caps (self-hosted) only enforce the floor.
  const maxIssues = clampToCap(input.maxIssues, MIN_ISSUES, MAX_ISSUES_CAP);
  const maxTurnsPerIssue = clampToCap(
    input.maxTurnsPerIssue,
    MIN_TURNS_PER_ISSUE,
    MAX_TURNS_PER_ISSUE_CAP,
  );

  const { data: project, error: readErr } = await supabase
    .from("projects")
    .select("status, slug")
    .eq("id", input.projectId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!project) throw new Error("Not found.");
  // The new SetupForm covers both ready_for_interview (first time
  // through) and interviewing (returning to revise). Either source
  // status is fine; we always finish at `reviewing`.
  if (
    project.status !== "ready_for_interview" &&
    project.status !== "interviewing"
  ) {
    throw new Error(`Cannot start review from status '${project.status}'.`);
  }

  // Validate the party split before we touch anything.
  const { data: rows, error: partiesErr } = await supabase
    .from("project_parties")
    .select("id")
    .eq("project_id", input.projectId);
  if (partiesErr) throw partiesErr;

  const userIds = new Set(input.userPartyIds);
  for (const id of userIds) {
    if (!rows?.some((r) => r.id === id)) {
      throw new Error("Picked party does not belong to this project.");
    }
  }
  if (userIds.size === 0) {
    throw new Error("Pick at least one party you represent.");
  }
  if (userIds.size === (rows?.length ?? 0)) {
    throw new Error("At least one party must be on the counterparty side.");
  }

  // Write party sides (two updates, RLS gates them).
  const userIdArray = Array.from(userIds);
  if (userIdArray.length > 0) {
    const { error } = await supabase
      .from("project_parties")
      .update({ is_user_side: true })
      .in("id", userIdArray);
    if (error) throw error;
  }
  const counterIds = (rows ?? [])
    .filter((r) => !userIds.has(r.id))
    .map((r) => r.id);
  if (counterIds.length > 0) {
    const { error } = await supabase
      .from("project_parties")
      .update({ is_user_side: false })
      .in("id", counterIds);
    if (error) throw error;
  }

  // Draft ownership + tuning knobs. Provider was snapshotted at
  // project creation from the user's default and is intentionally
  // immutable per-project — switching mid-project would split a
  // run's history across two model families.
  {
    const { error } = await supabase
      .from("projects")
      .update({
        draft_ownership: input.draftOwnership,
        max_issues: maxIssues,
        max_turns_per_issue: maxTurnsPerIssue,
      })
      .eq("id", input.projectId);
    if (error) throw error;
  }

  // Interview answers — upsert both (empty strings allowed; the
  // agents read whatever's there).
  {
    const { error } = await supabase.from("interview_answers").upsert(
      [
        {
          project_id: input.projectId,
          question_key: "user_side_details",
          answer: input.userSideDetails,
        },
        {
          project_id: input.projectId,
          question_key: "counterparty_details",
          answer: input.counterpartyDetails,
        },
      ],
      { onConflict: "project_id,question_key" },
    );
    if (error) throw error;
  }

  // Final transition.
  {
    const { error } = await supabase
      .from("projects")
      .update({ status: "reviewing" })
      .eq("id", input.projectId);
    if (error) throw error;
  }

  if (project.slug) revalidatePath(`/projects/${project.slug}`);
}
