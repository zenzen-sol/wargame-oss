// Pure extraction call. Takes a list of file contents + an AI SDK
// model client (no implicit env reads — boundary discipline) and
// returns the cleaned, normalized metadata. Phase 08 wires this into
// a Convex action that pulls files from the database and patches the
// project + projectParties tables with the result.

import { type LanguageModel, generateObject } from "ai";
import {
  type ExtractedParty,
  normalizeParties,
  normalizeTitle,
} from "./clean";
import { extractionPrompt, extractionSchema } from "./schema";

const MIN_TEXT_LENGTH = 50;
const HEAD_CHARS = 6_000;
const TAIL_CHARS = 3_000;

export interface ExtractedMetadata {
  title: string | null;
  parties: ExtractedParty[];
  /** Token counts the provider reported. Both default to 0 for the
   *  short-circuit path (no usable files) where no LLM call is made. */
  usage: { inputTokens: number; outputTokens: number };
}

export interface ExtractInput {
  files: Array<{ name: string; markdownContent: string }>;
  model: LanguageModel;
  /** Optional telemetry hook; passed through to AI SDK. */
  telemetryFunctionId?: string;
  /** Free-form metadata for telemetry. */
  telemetryMetadata?: Record<string, string | number | boolean>;
}

function truncate(text: string): string {
  if (text.length <= HEAD_CHARS + TAIL_CHARS) return text;
  return `${text.slice(0, HEAD_CHARS)}\n\n[... middle of file omitted ...]\n\n${text.slice(-TAIL_CHARS)}`;
}

export async function extract({
  files,
  model,
  telemetryFunctionId,
  telemetryMetadata,
}: ExtractInput): Promise<ExtractedMetadata> {
  const usable = files.filter(
    (f) => f.markdownContent.trim().length >= MIN_TEXT_LENGTH,
  );
  if (usable.length === 0) {
    return {
      title: null,
      parties: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const filesBlock = usable
    .map((f, i) => `[FILE ${i + 1}: ${f.name}]\n${truncate(f.markdownContent)}`)
    .join("\n\n");

  const result = await generateObject({
    model,
    schema: extractionSchema,
    experimental_telemetry: telemetryFunctionId
      ? {
          isEnabled: true,
          functionId: telemetryFunctionId,
          metadata: telemetryMetadata,
        }
      : undefined,
    prompt: extractionPrompt(filesBlock),
  });

  return {
    title: normalizeTitle(result.object.title),
    parties: normalizeParties(result.object.parties),
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}
