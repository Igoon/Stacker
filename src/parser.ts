export interface ParseResult {
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  catatan: string;
}

export interface LocalParse {
  result: ParseResult;
  confidence: "high" | "low";
  reason?: string;
}

const MASUK = ["gaji", "bonus", "thr", "terima", "dapat", "masuk", "income", "penghasilan", "jual", "profit"];

const KATEGORI: [string, string[]][] = [
  ["Makanan", ["makan", "minum", "sarapan", "kopi", "jajan", "camilan", "resto", "warteg", "nasi", "ayam", "bakso", "indomaret", "alfamart"]],
  ["Transportasi", ["transport", "ojek", "bensin", "gojek", "grab", "taksi", "parkir", "tol", "kereta", "bus", "angkot", "tiket"]],
  ["Belanja", ["belanja", "beli", "shopping", "baju", "sepatu", "tokopedia", "shopee"]],
  ["Tagihan", ["listrik", "air", "internet", "pulsa", "kuota", "tagihan", "token", "wifi", "bpjs", "cicilan", "sewa", "kos"]],
  ["Kesehatan", ["obat", "dokter", "klinik", "rumah sakit", "vitamin", "apotek"]],
  ["Hiburan", ["nonton", "bioskop", "game", "topup", "spotify", "netflix", "liburan", "jalan"]],
  ["Gaji", ["gaji", "upah", "honor", "thr", "bonus"]],
];

export const KATEGORI_NAMES = ["Makanan", "Transportasi", "Belanja", "Tagihan", "Kesehatan", "Hiburan", "Gaji", "Lainnya"];

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
  const numRe = /(\d[\d.,]*)\s*(jt|juta|rb|ribu|k)?/gi;
  const found = [...text.matchAll(numRe)]
    .map((m) => ({ raw: m[1], suffix: m[2] ?? "", value: parseNumber(m[1], m[2] ?? "") }))
    .filter((x) => Number.isFinite(x.value) && x.value > 0);

  if (found.length === 0) return null;

  const suffixed = found.filter((x) => MULT[x.suffix.toLowerCase()]);
  const chosen = suffixed.length > 0 ? suffixed[0] : found.reduce((a, b) => (b.value > a.value ? b : a));

  const low = text.toLowerCase();
  const tipe: "masuk" | "keluar" = MASUK.some((k) => low.includes(k)) ? "masuk" : "keluar";

  let kategori = "Lainnya";
  let kategoriKetemu = false;
  for (const [nama, kws] of KATEGORI) {
    if (kws.some((k) => low.includes(k))) {
      kategori = nama;
      kategoriKetemu = true;
      break;
    }
  }

  const result: ParseResult = { jumlah: chosen.value, tipe, kategori, catatan: text.trim() };

  let reason: string | undefined;
  if (found.length > 1) reason = "beberapa angka";
  else if (!chosen.suffix && chosen.value < 1000) reason = "angka tanpa satuan";
  else if (!kategoriKetemu) reason = "kategori tak dikenal";

  return { result, confidence: reason ? "low" : "high", reason };
}