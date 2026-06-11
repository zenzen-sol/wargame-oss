// Read-side helpers for the document viewer.
//
// Returns metadata only — versionId, fileName, source kind, version
// number. The viewer fetches the actual .docx bytes on demand via
// the `getDraftVersionUrl` server action; signed URLs never live in
// the SSR payload, so they can never go stale before the browser
// uses them.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database.types";

type VersionRow = Tables<"project_document_versions">;
type FileRow = Tables<"files">;

/** Server-side data shape for a working-draft viewer source. The
 *  client wraps each row with a `getUrl` closure before passing it
 *  to `<DraftViewer />` (whose runtime type adds the callback). */
export interface DraftViewerSourceData {
  fileId: string;
  fileName: string;
  versionId: string;
  source: VersionRow["source"];
  versionNumber: number;
}

export interface DraftViewerData {
  /** Default per-file pick the viewer renders at rest. */
  sources: DraftViewerSourceData[];
  /** Every proposal version with a non-null message_id, keyed by that
   *  message_id. Lets the chat's proposal links open the exact draft
   *  the message produced (rather than the latest pick). */
  proposalsByMessageId: Record<string, DraftViewerSourceData>;
}

export async function getDraftViewerSources(args: {
  projectId: string;
  /** When true, proposals on currently in-flight issues are eligible
   *  baselines (so the user sees what's on the table mid-debate).
   *  When false, only upload + accepted rows count (baseline view). */
  includeProposals: boolean;
}): Promise<DraftViewerData> {
  const supabase = createAdminClient();

  // All files in the project, in display order.
  const { data: fileRows, error: filesErr } = await supabase
    .from("files")
    .select("id, name")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: true });
  if (filesErr) throw filesErr;
  if (!fileRows || fileRows.length === 0) {
    return { sources: [], proposalsByMessageId: {} };
  }

  // All versions for the project (small per-project working set).
  const { data: versionRows, error: versionsErr } = await supabase
    .from("project_document_versions")
    .select("*")
    .eq("project_id", args.projectId)
    .order("version_number", { ascending: false });
  if (versionsErr) throw versionsErr;

  // Group versions per file and pick the right "current" row.
  const byFile = new Map<string, VersionRow[]>();
  for (const v of versionRows ?? []) {
    const list = byFile.get(v.file_id) ?? [];
    list.push(v);
    byFile.set(v.file_id, list);
  }

  const out: DraftViewerSourceData[] = [];
  const fileNameById = new Map<string, string>();
  for (const file of fileRows as Pick<FileRow, "id" | "name">[]) {
    fileNameById.set(file.id, file.name);
    const versions = byFile.get(file.id) ?? [];
    const pick = chooseViewerVersion(versions, args.includeProposals);
    if (!pick) continue;
    out.push({
      fileId: file.id,
      fileName: file.name,
      versionId: pick.id,
      source: pick.source,
      versionNumber: pick.version_number,
    });
  }

  // Index every proposal version by its message_id so the chat's
  // proposal links can deep-link to the exact draft that turn wrote.
  const proposalsByMessageId: Record<string, DraftViewerSourceData> = {};
  for (const v of versionRows ?? []) {
    if (v.source !== "proposal" || !v.message_id) continue;
    const fileName = fileNameById.get(v.file_id);
    if (!fileName) continue;
    proposalsByMessageId[v.message_id] = {
      fileId: v.file_id,
      fileName,
      versionId: v.id,
      source: v.source,
      versionNumber: v.version_number,
    };
  }

  return { sources: out, proposalsByMessageId };
}

function chooseViewerVersion(
  versions: VersionRow[],
  includeProposals: boolean,
): VersionRow | undefined {
  // Versions arrive newest-first (sorted by version_number desc).
  // Baseline candidates are upload + accepted rows.
  // Proposal candidates are honoured only when `includeProposals` is
  // true AND there is no newer accepted row above them (we don't want
  // a stale proposal from a closed issue obscuring the new baseline).
  let firstBaseline: VersionRow | undefined;
  let firstProposalAboveBaseline: VersionRow | undefined;
  for (const v of versions) {
    if (v.source === "accepted" || v.source === "upload") {
      firstBaseline = v;
      break;
    }
    if (
      includeProposals &&
      v.source === "proposal" &&
      !firstProposalAboveBaseline
    ) {
      firstProposalAboveBaseline = v;
    }
  }
  return firstProposalAboveBaseline ?? firstBaseline;
}
