// Combined tool set across review + negotiation + drafting phases.
// The UI side uses this with `InferUITools` to type tool parts on
// the persisted `UIMessage` regardless of which phase produced them.

import type { InferUITools } from "ai";
import { drafterTools } from "./drafter-tools";
import { memoTools } from "./memo-tools";
import { negotiationTools } from "./negotiation-tools";
import { reviewTools } from "./review-tools";

export const wargameTools = {
  ...reviewTools,
  ...negotiationTools,
  ...drafterTools,
  ...memoTools,
} as const;

export type WargameToolName = keyof typeof wargameTools;

export type WargameTools = InferUITools<typeof wargameTools>;
