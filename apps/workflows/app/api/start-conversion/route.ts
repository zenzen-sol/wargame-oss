// Trigger endpoint for the docx → markdown conversion. The saas
// `attachFile` action POSTs here after the browser uploads the .docx
// to Storage. We download the object, run it through
// `docxToMarkdown`, and write `markdown_content` + `conversion_status`
// back to the row.
//
// Auth: same shared-secret handshake as start-extraction. Token
// compromise lets a caller trigger conversion runs but doesn't
// expose DB access (admin client is local to this process).
import { validateAuthToken } from "@/lib/auth-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { docxToMarkdown } from "@wargame-esq/extraction/docx";
import { NextResponse, after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "project-files";

export async function POST(request: Request) {
  let body: { fileId?: unknown; authToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tokenErr = validateAuthToken(body.authToken);
  if (tokenErr) return tokenErr;
  if (typeof body.fileId !== "string" || body.fileId.length === 0) {
    return NextResponse.json(
      { error: "fileId is required" },
      { status: 400 },
    );
  }
  const fileId = body.fileId;

  const admin = createAdminClient();
  const { data: file, error: readErr } = await admin
    .from("files")
    .select("id, storage_key, conversion_status")
    .eq("id", fileId)
    .maybeSingle();
  if (readErr || !file) {
    return NextResponse.json(
      { error: readErr?.message ?? "File not found" },
      { status: 404 },
    );
  }
  if (file.conversion_status === "done") {
    return NextResponse.json({ ok: true, alreadyDone: true });
  }

  // Schedule the conversion via Next's `after()`. Two reasons over the
  // PR #15 await pattern:
  //
  //   1. The HTTP response can return immediately, so the saas trigger
  //      fetch (also scheduled via after() on its side) doesn't have to
  //      stay in flight for ~30s waiting for the conversion to finish.
  //      Cuts both Functions' billing in half.
  //
  //   2. Vercel guarantees the after() task runs to completion within
  //      the Function's maxDuration. Naked fire-and-forget (the
  //      original bug) had no such guarantee — the function could be
  //      torn down mid-conversion.
  //
  // The UI learns about the conversion outcome via Supabase Realtime
  // on the files table (apps/saas/lib/use-project-realtime.ts), which
  // fires postgres_changes → revalidateProjectBySlug when runConversion
  // updates the row below.
  after(() => runConversion(file.id, file.storage_key));

  return NextResponse.json({ ok: true });
}

async function runConversion(
  fileId: string,
  storageKey: string,
): Promise<void> {
  const admin = createAdminClient();
  const startedAt = Date.now();
  console.log(
    `[start-conversion] start fileId=${fileId.slice(0, 8)} key=${storageKey.slice(0, 32)}…`,
  );
  try {
    const downloadStart = Date.now();
    const { data, error } = await admin.storage
      .from(BUCKET)
      .download(storageKey);
    if (error || !data) {
      throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
    }
    const buffer = new Uint8Array(await data.arrayBuffer());
    const downloadMs = Date.now() - downloadStart;

    // Magic-byte check. Client-supplied MIME on attach is advisory
    // (`apps/saas/lib/actions/files.ts:42-60`); server-side we want
    // to confirm the bytes really are a .docx (which is a ZIP
    // container, "PK\x03\x04"). Without this check a user could
    // upload arbitrary content with a docx MIME and any downstream
    // consumer that trusts MIME — viewers, future export paths —
    // would mis-handle it.
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b ||
      buffer[2] !== 0x03 ||
      buffer[3] !== 0x04
    ) {
      throw new Error(
        "Uploaded file is not a valid .docx (ZIP magic bytes missing).",
      );
    }

    const convertStart = Date.now();
    const markdown = await docxToMarkdown(buffer);
    const convertMs = Date.now() - convertStart;

    const { error: updateErr } = await admin
      .from("files")
      .update({
        markdown_content: markdown,
        conversion_status: "done",
        conversion_error: null,
      })
      .eq("id", fileId);
    if (updateErr) throw updateErr;

    const totalMs = Date.now() - startedAt;
    console.log(
      `[start-conversion] done fileId=${fileId.slice(0, 8)} total=${totalMs}ms download=${downloadMs}ms convert=${convertMs}ms bytes=${buffer.byteLength} md=${markdown.length}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const totalMs = Date.now() - startedAt;
    console.error(
      `[start-conversion] failed fileId=${fileId.slice(0, 8)} after=${totalMs}ms message=${message}`,
    );
    await admin
      .from("files")
      .update({
        conversion_status: "failed",
        conversion_error: message,
      })
      .eq("id", fileId);
  }
}
