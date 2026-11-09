// Aturan riwayat perintah: normalisasi, unik (case-insensitive), batas panjang.
export const HISTORY_LIMIT = 30;
export const HISTORY_MAX_LENGTH = 500;

const META_COMMAND_RE = /^(undo|redo|ulangi|batalkan|batal)$/i;

export function normalizeHistoryEntry(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function shouldRememberCommand(text: string): boolean {
  const entry = normalizeHistoryEntry(text);
  return entry !== "" && entry.length <= HISTORY_MAX_LENGTH && !META_COMMAND_RE.test(entry);
}

export function addHistoryEntry(
  list: readonly string[],
  text: string,
  limit = HISTORY_LIMIT,
): string[] {
  const entry = normalizeHistoryEntry(text);
  if (!shouldRememberCommand(entry) || limit <= 0) {
    return list.slice(0, limit);
  }
  const key = entry.toLowerCase();
  const rest = list.filter((item) => normalizeHistoryEntry(item).toLowerCase() !== key);
  return [entry, ...rest].slice(0, limit);
}
