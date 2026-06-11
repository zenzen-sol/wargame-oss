"use server";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function getProjectSlug(projectId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("slug")
    .eq("id", projectId)
    .maybeSingle();
  return data?.slug ?? null;
}

export async function updatePartyName(input: {
  id: string;
  name: string;
}): Promise<void> {
  const trimmed = input.name.trim();
  if (trimmed.length === 0) throw new Error("Party name cannot be empty.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_parties")
    .update({ name: trimmed, is_placeholder: false })
    .eq("id", input.id)
    .select("project_id")
    .maybeSingle();
  if (error) throw error;
  if (data) {
    const slug = await getProjectSlug(data.project_id);
    if (slug) revalidatePath(`/projects/${slug}`);
  }
}

export async function updatePartyRole(input: {
  id: string;
  role: string;
}): Promise<void> {
  const trimmed = input.role.trim();
  if (trimmed.length === 0) throw new Error("Party role cannot be empty.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_parties")
    .update({ role: trimmed })
    .eq("id", input.id)
    .select("project_id")
    .maybeSingle();
  if (error) throw error;
  if (data) {
    const slug = await getProjectSlug(data.project_id);
    if (slug) revalidatePath(`/projects/${slug}`);
  }
}

export async function addPartyToSide(input: {
  projectId: string;
  side: number;
  role?: string;
}): Promise<{ id: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_parties")
    .insert({
      project_id: input.projectId,
      side: input.side,
      name: "",
      role: input.role ?? null,
      is_placeholder: true,
      // is_user_side stays NULL until the setup form confirms sides.
    })
    .select("id")
    .single();
  if (error) throw error;
  const slug = await getProjectSlug(input.projectId);
  if (slug) revalidatePath(`/projects/${slug}`);
  return { id: data.id };
}

export async function removeParty(input: { id: string }): Promise<void> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("project_parties")
    .select("project_id")
    .eq("id", input.id)
    .maybeSingle();
  const { error } = await supabase
    .from("project_parties")
    .delete()
    .eq("id", input.id);
  if (error) throw error;
  if (row) {
    const slug = await getProjectSlug(row.project_id);
    if (slug) revalidatePath(`/projects/${slug}`);
  }
}
