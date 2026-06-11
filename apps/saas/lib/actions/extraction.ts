"use server";
import { requireUserWithDisclaimer } from "@/lib/auth-session";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function startExtraction(input: {
  projectId: string;
}): Promise<void> {
  const user = await requireUserWithDisclaimer();
  const supabase = await createClient();

  // Rate limit. Extraction triggers a Vercel Workflow run + one LLM
  // call against the contract; cheap individually but spammable. The
  // 1/min burst gate stops accidental double-clicks too.
  const verdict = await checkRateLimit({
    userId: user.id,
    bucket: "extraction",
  });
  if (!verdict.allowed) {
    throw new Error(
      `Too many extraction attempts. Try again in ${verdict.retryAfterSec}s.`,
    );
  }

  const { data: project, error: readErr } = await supabase
    .from("projects")
    .select("status, slug")
    .eq("id", input.projectId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!project) throw new Error("Not found.");
  if (project.status !== "draft") {
    throw new Error(
      `Cannot start extraction on a project in '${project.status}'. Only 'draft' projects can be started.`,
    );
  }

  const { data: files, error: filesErr } = await supabase
    .from("files")
    .select("conversion_status")
    .eq("project_id", input.projectId);
  if (filesErr) throw filesErr;
  if (!files || files.length === 0) {
    throw new Error("Upload at least one .docx before starting extraction.");
  }
  const stillConverting = files.filter(
    (f) => f.conversion_status === "pending",
  ).length;
  if (stillConverting > 0) {
    throw new Error(
      `Conversion still running on ${stillConverting} file(s). Wait a moment and try again.`,
    );
  }
  const failedConversion = files.filter(
    (f) => f.conversion_status === "failed",
  ).length;
  if (failedConversion > 0) {
    throw new Error(
      `${failedConversion} file(s) failed to convert. Remove or retry before starting.`,
    );
  }

  const { error: updateErr } = await supabase
    .from("projects")
    .update({
      status: "extracting",
      failure_message: null,
      cancel_requested_at: null,
    })
    .eq("id", input.projectId);
  if (updateErr) throw updateErr;
  if (project.slug) revalidatePath(`/projects/${project.slug}`);

  const triggerUrl = process.env.WORKFLOW_TRIGGER_URL;
  const authToken = process.env.WORKFLOW_AUTH_TOKEN;
  if (!triggerUrl || !authToken) {
    throw new Error(
      "WORKFLOW_TRIGGER_URL and WORKFLOW_AUTH_TOKEN must be set.",
    );
  }
  const triggerResponse = await fetch(`${triggerUrl}/start-extraction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: input.projectId, authToken }),
  });
  if (!triggerResponse.ok) {
    // Roll back so the user can retry.
    await supabase
      .from("projects")
      .update({
        status: "draft",
        failure_message: `Workflow trigger failed (${triggerResponse.status}).`,
      })
      .eq("id", input.projectId);
    if (project.slug) revalidatePath(`/projects/${project.slug}`);
    throw new Error("Failed to trigger extraction workflow.");
  }
}
