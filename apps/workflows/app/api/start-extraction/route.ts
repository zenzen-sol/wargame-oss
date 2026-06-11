import { validateAuthToken } from "@/lib/auth-token";
import { extractionWorkflow } from "@/workflows/extraction";
import { NextResponse } from "next/server";
import { start } from "workflow/api";

/**
 * Trigger endpoint for the extraction workflow. The saas server
 * action authenticates the user, flips status to `extracting` in
 * Postgres, then POSTs here to fire the durable workflow.
 *
 * Auth: a single shared secret between the saas and workflows
 * deployments (`WORKFLOW_AUTH_TOKEN`). This protects the trigger
 * surface only — the workflow itself talks to Postgres via its own
 * `wargame_server` connection, so trigger compromise doesn't grant
 * arbitrary DB access. The token is rotated per-environment.
 */
export async function POST(request: Request) {
  let body: { projectId?: unknown; authToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tokenErr = validateAuthToken(body.authToken);
  if (tokenErr) return tokenErr;
  if (typeof body.projectId !== "string" || body.projectId.length === 0) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 },
    );
  }

  await start(extractionWorkflow, [body.projectId]);

  return NextResponse.json({ ok: true });
}
