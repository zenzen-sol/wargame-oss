import type { MessageMetadata } from "@/lib/ui-message";

type Agent = MessageMetadata["agent"];
type DbRole = MessageMetadata["dbRole"];

export const AGENT_BADGE: Record<
  Agent,
  { label: string; tone: string }
> = {
  blue: { label: "Blue", tone: "text-team-blue" },
  red: { label: "Red", tone: "text-team-red" },
  system: { label: "System", tone: "text-muted-foreground" },
};

export const ROLE_LABEL: Record<DbRole, string> = {
  review: "Initial review",
  argument: "Argument",
  resolution: "Resolution",
  interview: "Interview",
  thinking: "Thinking",
};
