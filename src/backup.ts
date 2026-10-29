// backup.ts (mobile) — tanpa filesystem. Snapshot disimpan di tabel settings,
// plus export/import JSON untuk pindah device / arsip manual.
import { exportAll, importAll, setSetting, getSetting } from "./db";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function trackKey(key: string): void {
  const keys = JSON.parse(getSetting("_backup_keys") ?? "[]") as string[];
  keys.push(key);
  // Batasi 20 snapshot terakhir.
  const trimmed = keys.slice(-20);
  setSetting("_backup_keys", JSON.stringify(trimmed));
  // Hapus snapshot lama dari settings.
  for (const k of keys.slice(0, -20)) setSetting(k, null);
}

// Simpan snapshot pra-operasi destruktif. Return nama label (tanpa path).
export async function backupTagged(tag: string): Promise<string> {
  const key = `backup_${tag}_${stamp()}`;
  setSetting(key, exportAll());
  trackKey(key);
  return key;
}

export function listBackups(): string[] {
  return JSON.parse(getSetting("_backup_keys") ?? "[]") as string[];
}

export function exportJson(): string {
  return exportAll();
}

export function importJson(json: string): void {
  importAll(json);
}
