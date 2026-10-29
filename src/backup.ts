// backup.ts (mobile) — tanpa filesystem. Backup/restore manual lewat file JSON
// (tombol ⬇ Backup / ⬆ Restore + file otomatis saat reset transaksi).
import { exportAll, importAll } from "./db";

export function exportJson(): string {
  return exportAll();
}

export function importJson(json: string): void {
  importAll(json);
}
