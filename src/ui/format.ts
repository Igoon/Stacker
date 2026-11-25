// ui/format.ts — helper pemformatan angka, tanggal, versi, kartu transaksi, dan unduh file.
import { shortRp } from "../chart";
import type { Tx } from "../db";

export function isNewer(remote: string, local: string): boolean {
  const a = remote.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const b = local.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function fmtRp(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? "-" : "") + "Rp" + Math.abs(v).toLocaleString("id-ID");
}

export function fmtShortRp(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return (n < 0 ? "-" : "") + "Rp" + shortRp(n);
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function timeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(
    2,
    "0"
  )}${String(d.getSeconds()).padStart(2, "0")}`;
}

export function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : 0;
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function fmtTxDate(iso?: string | null): string {
  if (!iso) return "";
  const now = new Date();
  const today = todayStr();
  if (iso === today) return "Hari ini";
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestIso = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, "0")}-${String(
    yest.getDate()
  ).padStart(2, "0")}`;
  if (iso === yestIso) return "Kemarin";
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return iso;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const sameYear = parts[0] === now.getFullYear();
  try {
    return d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "2-digit" }),
    });
  } catch {
    return iso.slice(5);
  }
}

export function txTitle(tx: Tx): string {
  const note = (tx.catatan ?? "").trim();
  if (note && note.toLowerCase() !== tx.kategori.toLowerCase()) return note;
  return tx.kategori;
}

export function txMetaText(tx: Tx): string {
  const parts: string[] = [];
  const title = txTitle(tx);
  if (title.toLowerCase() !== tx.kategori.toLowerCase()) parts.push(tx.kategori);
  if (tx.akun) parts.push(tx.akun);
  const dt = fmtTxDate(tx.tanggal);
  if (dt) parts.push(dt);
  parts.push(`#${tx.id}`);
  return parts.join(" · ");
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function saveFile(name: string, content: string): void {
  const isJson = /\.json$/i.test(name);
  const type = isJson ? "application/json" : "text/csv";
  const body = isJson ? content : "\ufeff" + content;
  const blob = new Blob([body], { type });
  try {
    const share = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data?: ShareData) => Promise<void>;
    };
    const f = new File([blob], name, { type });
    if (share.canShare && share.canShare({ files: [f] }) && share.share) {
      void share.share({ files: [f], title: name }).catch(() => downloadBlob(blob, name));
      return;
    }
  } catch {
    // jatuh ke unduhan biasa
  }
  downloadBlob(blob, name);
}
