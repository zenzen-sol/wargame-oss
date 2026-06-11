// Shared poll constants + types. Lives outside the "use server"
// action module because Next disallows non-async exports from server
// modules (the form component needs to import the enums client-side).

// Both interest questions share the same yes/maybe/no shape — one
// enum, two question slots.
export const TRIVALENT_VALUES = ["yes", "maybe", "no"] as const;
export type Trivalent = (typeof TRIVALENT_VALUES)[number];

export type WantsUnlimited = Trivalent;
export const WANTS_UNLIMITED_VALUES = TRIVALENT_VALUES;

export type WantsMoreModels = Trivalent;
export const WANTS_MORE_MODELS_VALUES = TRIVALENT_VALUES;

export const PRICE_BAND_VALUES = [
  "free_only",
  "under_20",
  "20_50",
  "50_100",
  "100_250",
  "over_250",
] as const;
export type PriceBand = (typeof PRICE_BAND_VALUES)[number];

export interface PollResponse {
  wantsUnlimited: WantsUnlimited;
  wantsMoreModels: WantsMoreModels | null;
  priceBand: PriceBand | null;
  comment: string;
}
