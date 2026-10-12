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
  explicitTipe?: boolean;
}

export const MASUK = [
  "gaji", "bonus", "thr", "terima", "dapat", "masuk", "income", "penghasilan", "jual", "profit",
  "bunga", "dividen", "deviden", "kupon", "cashback", "refund", "pengembalian", "menang", "komisi",
];

const KELUAR_WORDS = ["keluar", "pengeluaran"];
const MASUK_EXTRA = ["masuk", "pemasukan", "pendapatan", "terima"];

const MULT: Record<string, number> = {
  rb: 1e3, ribu: 1e3, k: 1e3,
  jt: 1e6, juta: 1e6,
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function kwMatch(low: string, kw: string): boolean {
  const k = kw.toLowerCase().trim();
  if (!k) return false;
  const esc = escapeRe(k);
  const re =
    k.length <= 3
      ? new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i")
      : new RegExp(`(?<![a-z0-9])${esc}`, "i");
  return re.test(low);
}

const UNITS: Record<string, number> = {
  nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
};

const NORMALIZE: Record<string, string> = {
  sepuluh: "satu puluh",
  sebelas: "satu belas",
  seratus: "satu ratus",
  seribu: "satu ribu",
  sejuta: "satu juta",
};

const NUMBER_WORDS = new Set([
  ...Object.keys(UNITS), "puluh", "belas", "ratus", "ribu", "juta", "miliar", "milyar",
]);

function parseIdNumber(tokens: string[]): number {
  const scales: [string, number][] = [
    ["miliar", 1e9], ["milyar", 1e9], ["juta", 1e6], ["ribu", 1e3], ["ratus", 100], ["puluh", 10],
  ];
  for (const [word, val] of scales) {
    const i = tokens.indexOf(word);
    if (i >= 0) {
      const left = tokens.slice(0, i);
      const right = tokens.slice(i + 1);
      const lv = left.length ? parseIdNumber(left) : 1;
      return lv * val + parseIdNumber(right);
    }
  }
  let sum = 0;
  for (const t of tokens) {
    if (UNITS[t] != null) sum += UNITS[t];
    else if (t === "belas") sum += 10;
  }
  return sum;
}

function wordsToNumber(text: string): { value: number; matched: boolean } {
  const raw = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  let matched = false;
  const tokens: string[] = [];
  for (const w of raw) {
    if (NORMALIZE[w]) {
      tokens.push(...NORMALIZE[w].split(" "));
      matched = true;
    } else if (NUMBER_WORDS.has(w)) {
      tokens.push(w);
      matched = true;
    }
  }
  if (!matched) return { value: 0, matched: false };
  return { value: parseIdNumber(tokens), matched: true };
}

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
  const low = cleaned.toLowerCase();

  const numRe = /(\d[\d.,]*)\s*(jt|juta|rb|ribu|k)?/gi;
  let found = [...cleaned.matchAll(numRe)]
    .map((m) => ({ raw: m[1], suffix: m[2] ?? "", value: parseNumber(m[1], m[2] ?? "") }))
    .filter((x) => Number.isFinite(x.value) && x.value > 0);

  if (found.length === 0) {
    const wn = wordsToNumber(cleaned);
    if (wn.matched && wn.value > 0) found = [{ raw: "", suffix: "", value: wn.value }];
  }

  if (found.length === 0) return null;

  const suffixed = found.filter((x) => MULT[x.suffix.toLowerCase()]);
  const chosen = suffixed.length > 0 ? suffixed[0] : found.reduce((a, b) => (b.value > a.value ? b : a));

  let tipe: "masuk" | "keluar";
  let explicitTipe = false;
  if (KELUAR_WORDS.some((w) => kwMatch(low, w))) {
    tipe = "keluar";
    explicitTipe = true;
  } else if (MASUK_EXTRA.some((w) => kwMatch(low, w))) {
    tipe = "masuk";
    explicitTipe = true;
  } else {
    tipe = MASUK.some((k) => kwMatch(low, k)) ? "masuk" : "keluar";
  }

  let kategori = "Lainnya";
  let kategoriKetemu = false;
  let bestLen = 0;
  for (const cat of listCategories(tipe)) {
    for (const k of cat.keywords) {
      const kk = k.toLowerCase().trim();
      if (!kk) continue;
      if (kk.length > bestLen && kwMatch(low, kk)) {
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
  else if (!kategoriKetemu && !explicitTipe) reason = "kategori tak dikenal";

  return { result, confidence: reason ? "low" : "high", reason, explicitTipe };
}