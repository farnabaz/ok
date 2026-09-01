/** Collapse whitespace and truncate for previews. */
export function truncate(value: string, limit: number): string {
  const words = value.replace(/\n/g, " ").split(/\s+/).join(" ");
  if (words.length <= limit) return words;
  return words.slice(0, limit) + "…";
}

/** Trim text to a single visible column width (ASCII-safe length). */
export function fitWidth(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max === 1) return "…";
  return text.slice(0, max - 1) + "…";
}

/** Human-readable relative age from a unix-seconds timestamp. */
export function age(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const seconds = Math.max(0, now - timestamp);
  if (seconds <= 59) return `${seconds}s ago`;
  if (seconds <= 3599) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds <= 86399) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
