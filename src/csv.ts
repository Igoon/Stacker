import { rupiah, type Tx } from "./db";
import { isoLocal } from "./dates";

function cell(v: string | number | null): string {
  let s = String(v ?? "");
  // Cegah formula injection di spreadsheet: nilai teks yang diawali salah satu
  // karakter ini diberi prefix apostrof (ditampilkan sebagai teks biasa).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: Tx[]): string {
  const head = ["id", "tanggal", "tipe", "akun", "kategori", "jumlah", "catatan"];
  const lines = rows.map((t) =>
    [t.id, t.tanggal, t.tipe, t.akun ?? "", t.kategori, t.jumlah, t.catatan ?? ""].map(cell).join(",")
  );
  const total = rows.reduce((a, t) => a + (t.tipe === "masuk" ? t.jumlah : -t.jumlah), 0);
  lines.push(["", "", "", "", "selisih", total, rupiah(total)].map(cell).join(","));
  return [head.join(","), ...lines].join("\r\n");
}

export interface CsvTxRow {
  tanggal: string;
  tipe: "masuk" | "keluar";
  akun: string;
  kategori: string;
  jumlah: number;
  catatan: string;
}

function splitCsvLines(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === sep) {
      row.push(cur);
      cur = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cur = "";
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function unescapeCell(s: string): string {
  const t = s.trim();
  return t.startsWith("'") && /^[=+\-@\t\r]/.test(t.slice(1)) ? t.slice(1) : t;
}

export function parseCSV(raw: string): { rows: CsvTxRow[]; skipped: number; skippedTransfers: number } {
  const clean = raw.replace(/^\ufeff/, "").trim();
  if (!clean) return { rows: [], skipped: 0, skippedTransfers: 0 };
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const matrix = splitCsvLines(clean, sep);
  if (matrix.length < 2) return { rows: [], skipped: 0, skippedTransfers: 0 };

  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]): number => header.findIndex((h) => names.includes(h));
  const iTgl = col("tanggal", "date", "tgl");
  const iTipe = col("tipe", "type", "arah");
  const iAkun = col("akun", "account", "dompet", "rekening");
  const iKat = col("kategori", "category");
  const iJml = col("jumlah", "nominal", "amount");
  const iCat = col("catatan", "note", "notes", "deskripsi", "keterangan");

  if (iJml < 0) return { rows: [], skipped: matrix.length - 1, skippedTransfers: 0 };

  const isValidIsoDate = (s: string): boolean => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  };

  const rows: CsvTxRow[] = [];
  let skipped = 0;
  let skippedTransfers = 0;
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    const katRaw = iKat >= 0 ? unescapeCell(line[iKat] ?? "") : "";
    if (katRaw.toLowerCase() === "selisih" && (iTgl < 0 || !unescapeCell(line[iTgl] ?? ""))) {
      continue; // baris ringkasan bawaan toCSV
    }
    // Lewati baris transfer agar tidak terimpor menjadi 2 transaksi biasa.
    if (katRaw.toLowerCase() === "transfer") {
      skippedTransfers++;
      skipped++;
      continue;
    }
    const jmlRaw = unescapeCell(line[iJml] ?? "").replace(/[^\d\-.,]/g, "");
    const num = Number(jmlRaw.replace(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(num) || num === 0) {
      skipped++;
      continue;
    }
    const tglRaw = iTgl >= 0 ? unescapeCell(line[iTgl] ?? "") : "";
    let tanggal: string;
    if (!tglRaw) {
      tanggal = isoLocal();
    } else if (isValidIsoDate(tglRaw)) {
      tanggal = tglRaw;
    } else {
      skipped++;
      continue; // jangan diam-diam ganti tanggal tak valid dengan hari ini
    }
    const tipeRaw = iTipe >= 0 ? unescapeCell(line[iTipe] ?? "").toLowerCase() : "";
    const tipe: "masuk" | "keluar" =
      tipeRaw === "masuk" || tipeRaw === "income" || tipeRaw === "in"
        ? "masuk"
        : tipeRaw === "keluar" || tipeRaw === "expense" || tipeRaw === "out"
          ? "keluar"
          : "keluar";
    rows.push({
      tanggal,
      tipe,
      akun: iAkun >= 0 ? unescapeCell(line[iAkun] ?? "") : "",
      kategori: katRaw || "Lainnya",
      jumlah: Math.round(Math.abs(num)),
      catatan: iCat >= 0 ? unescapeCell(line[iCat] ?? "") : "",
    });
  }
  return { rows, skipped, skippedTransfers };
}
