import { GoogleGenAI, Type } from "@google/genai";
import { KATEGORI_NAMES, type ParseResult } from "./parser";

const KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const TIMEOUT_MS = 6000;
const CACHE_TTL = 1000 * 60 * 60 * 6;

export const aiEnabled = KEY.trim().length > 0;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: KEY });
  return client;
}

const SYSTEM_PROMPT =
  "Kamu parser transaksi keuangan berbahasa Indonesia. " +
  "Ubah pesan user jadi daftar transaksi. Pisahkan bila ada beberapa transaksi. " +
  "Nominal dalam Rupiah, integer, tanpa titik. Contoh: '50rb'=50000, '1,5jt'=1500000. " +
  "tipe 'masuk' untuk pemasukan (gaji, bonus, terima uang), selain itu 'keluar'. " +
  `kategori WAJIB salah satu dari: ${KATEGORI_NAMES.join(", ")}. ` +
  "catatan = teks singkat transaksi. tanggal format YYYY-MM-DD bila disebut, jika tidak kosongkan.\n\n" +
  "Pesan user: ";

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          jumlah: { type: Type.INTEGER },
          tipe: { type: Type.STRING, enum: ["masuk", "keluar"] },
          kategori: { type: Type.STRING, enum: KATEGORI_NAMES },
          catatan: { type: Type.STRING },
          tanggal: { type: Type.STRING },
        },
        required: ["jumlah", "tipe", "kategori"],
      },
    },
  },
  required: ["transactions"],
};

const cache = new Map<string, { at: number; value: ParseResult[] }>();

function validate(raw: unknown): ParseResult[] {
  if (!raw || typeof raw !== "object") return [];
  const arr = (raw as { transactions?: unknown }).transactions;
  if (!Array.isArray(arr)) return [];
  const out: ParseResult[] = [];
  for (const item of arr) {
    const t = item as Record<string, unknown>;
    const jumlah = Math.round(Number(t.jumlah));
    if (!Number.isFinite(jumlah) || jumlah <= 0) continue;
    const tipe = t.tipe === "masuk" ? "masuk" : "keluar";
    const kategori = KATEGORI_NAMES.includes(String(t.kategori)) ? String(t.kategori) : "Lainnya";
    const catatan = String(t.catatan ?? "").trim() || "transaksi";
    out.push({ jumlah, tipe, kategori, catatan });
  }
  return out;
}

export async function parseGemini(text: string): Promise<ParseResult[] | null> {
  if (!aiEnabled) return null;
  const key = text.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

  try {
    const res = await getClient().models.generateContent({
      model: MODEL,
      contents: SYSTEM_PROMPT + text,
      config: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA as never,
        temperature: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });
    const parsed = JSON.parse(res.text ?? "{}");
    const list = validate(parsed);
    if (list.length) cache.set(key, { at: Date.now(), value: list });
    return list.length ? list : null;
  } catch (e) {
    console.error("[ai] gagal:", (e as Error).message);
    return null;
  }
}