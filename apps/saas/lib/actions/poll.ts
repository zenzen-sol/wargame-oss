"use server";

// Interest-poll server action. One row per user, upserted on every
// save so the user can refine their answers without us tracking a
// history. RLS-protected — the user-session client enforces that the
// caller can only read/write their own row.

import { requireUser } from "@/lib/auth-session";
import {
  PRICE_BAND_VALUES,
  type PollResponse,
  type PriceBand,
  TRIVALENT_VALUES,
  type WantsMoreModels,
  type WantsUnlimited,
  WANTS_UNLIMITED_VALUES,
} from "@/lib/poll-options";
import { createClient } from "@/lib/supabase/server";

const COMMENT_MAX = 2000;

export interface SavePollResponseResult {
  ok: boolean;
  message?: string;
}

export async function savePollResponse(input: {
  wantsUnlimited: WantsUnlimited;
  wantsMoreModels: WantsMoreModels;
  priceBand: PriceBand | null;
  comment: string;
}): Promise<SavePollResponseResult> {
  const user = await requireUser();

  if (!WANTS_UNLIMITED_VALUES.includes(input.wantsUnlimited)) {
    return { ok: false, message: "Invalid first answer." };
  }
  if (!TRIVALENT_VALUES.includes(input.wantsMoreModels)) {
    return { ok: false, message: "Invalid second answer." };
  }
  if (input.priceBand !== null && !PRICE_BAND_VALUES.includes(input.priceBand)) {
    return { ok: false, message: "Invalid third answer." };
  }
  // Pricing is only meaningful when the user is interested in at
  // least one of the upgrades. If both questions are "no", blank the
  // band so the row reflects the lack of demand cleanly.
  const anyInterest =
    input.wantsUnlimited !== "no" || input.wantsMoreModels !== "no";
  const priceBand = anyInterest ? input.priceBand : null;

  const comment = input.comment.trim().slice(0, COMMENT_MAX);

  const supabase = await createClient();
  const { error } = await supabase.from("poll_responses").upsert(
    {
      user_id: user.id,
      wants_unlimited: input.wantsUnlimited,
      wants_more_models: input.wantsMoreModels,
      price_band: priceBand,
      comment: comment.length > 0 ? comment : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[poll] save failed", { userId: user.id, error });
    return { ok: false, message: "Could not save your response. Try again." };
  }
  return { ok: true };
}

export async function getPollResponse(): Promise<PollResponse | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("poll_responses")
    .select("wants_unlimited, wants_more_models, price_band, comment")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[poll] read failed", { userId: user.id, error });
    return null;
  }
  if (!data) return null;
  const wantsUnlimited = (WANTS_UNLIMITED_VALUES as readonly string[]).includes(
    data.wants_unlimited,
  )
    ? (data.wants_unlimited as WantsUnlimited)
    : null;
  if (!wantsUnlimited) return null;
  // wants_more_models is nullable in DB: rows written before the
  // column existed return null here; the form treats that as
  // unanswered and surfaces the question again.
  const wantsMoreModels =
    data.wants_more_models &&
    (TRIVALENT_VALUES as readonly string[]).includes(data.wants_more_models)
      ? (data.wants_more_models as WantsMoreModels)
      : null;
  const priceBand =
    data.price_band &&
    (PRICE_BAND_VALUES as readonly string[]).includes(data.price_band)
      ? (data.price_band as PriceBand)
      : null;
  return {
    wantsUnlimited,
    wantsMoreModels,
    priceBand,
    comment: data.comment ?? "",
  };
}
