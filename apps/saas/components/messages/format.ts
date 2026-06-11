// Small formatting helpers for message timestamps + durations.
// Shared by the conversation column and the reasoning side panels.

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function formatTimestampWithDuration(
  ts: number,
  durationMs: number,
): string {
  if (durationMs <= 0) return formatTime(ts);
  return `@ ${formatTime(ts)} / ${formatDuration(durationMs)}`;
}
