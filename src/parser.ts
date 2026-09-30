import { extractDate } from "./dates";
import { listCategories } from "./db";

export interface ParseResult {
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  catatan: string;
  tanggal?: string;
}

export interface LocalParse {
  result: ParseResult;
  confidence: "high" | "low";
  reason?: string;
}

export const MASUK = [
  "gaji", "bonus", "thr", "terima", "dapat", "masuk", "income", "penghasilan", "jual", "profit",
  "bunga", "dividen", "deviden", "kupon", "cashback", "refund", "pengembalian", "menang", "komisi",
];

const MULT: Record<string, number> = {
  rb: 1e3, ribu: 1e3, k: 1e3,
  jt: 1e6, juta: 1e6,
};

function parseNumber(raw: string, suffix: string): number {
  const s = suffix.toLowerCase();
  const mult = MULT[s] ?? 1;
  if (mult > 1) {
    return Math.round(parseFloat(raw.replace(",", ".")) * mult);
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) {
    return parseInt(raw.replace(/[.,]/g, ""), 10);
  }
  return Math.round(parseFloat(raw.replace(",", ".")));
}

export function parseLocal(text: string): LocalParse | null {
  const { tanggal, cleaned } = extractDate(text);
  const numRe = /(\d[\d.,]*)\s*(jt|juta|rb|ribu|k)?/gi;
  const found = [...cleaned.matchAll(numRe)]
    .map((m) => ({ raw: m[1], suffix: m[2] ?? "", value: parseNumber(m[1], m[2] ?? "") }))
    .filter((x) => Number.isFinite(x.value) && x.value > 0);

  if (found.length === 0) return null;

  const suffixed = found.filter((x) => MULT[x.suffix.toLowerCase()]);
  const chosen = suffixed.length > 0 ? suffixed[0] : found.reduce((a, b) => (b.value > a.value ? b : a));

  const low = cleaned.toLowerCase();
  const tipe: "masuk" | "keluar" = MASUK.some((k) => low.includes(k)) ? "masuk" : "keluar";

  let kategori = "Lainnya";
  let kategoriKetemu = false;
  let bestLen = 0;
  for (const cat of listCategories(tipe)) {
    for (const k of cat.keywords) {
      const kk = k.toLowerCase().trim();
      if (!kk) continue;
      if (low.includes(kk) && kk.length > bestLen) {
        bestLen = kk.length;
        kategori = cat.nama;
        kategoriKetemu = true;
      }
    }
  }

  const result: ParseResult = { jumlah: chosen.value, tipe, kategori, catatan: text.trim() };
  if (tanggal) result.tanggal = tanggal;

  let reason: string | undefined;
  if (found.length > 1) reason = "beberapa angka";
  else if (!chosen.suffix && chosen.value < 1000) reason = "angka tanpa satuan";
  else if (!kategoriKetemu) reason = "kategori tak dikenal";

  return { result, confidence: reason ? "low" : "high", reason };
}