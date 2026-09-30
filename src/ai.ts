import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { isoLocal } from "./dates";
import { categoryNames } from "./db";
import type { ParseResult } from "./parser";

const KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const TIMEOUT_MS = 6000;
const CACHE_TTL = 1000 * 60 * 60 * 6;
const DAILY_LIMIT = Math.max(0, Number(process.env.GEMINI_DAILY_LIMIT ?? 100));

const CACHE_FILE = path.join(process.cwd(), "ai-cache.json");
const USAGE_FILE = path.join(process.cwd(), "ai-usage.json");

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
  "catatan = teks singkat transaksi. tanggal format YYYY-MM-DD bila disebut, jika tidak kosongkan.\n\n" +
  "Pesan user: ";

function buildPrompt(masuk: string[], keluar: string[]): string {
  return SYSTEM_PROMPT.replace(
    "tanggal format YYYY-MM-DD bila disebut, jika tidak kosongkan.",
    `Kategori MASUK wajib salah satu dari: ${masuk.join(", ")}. ` +
      `Kategori KELUAR wajib salah satu dari: ${keluar.join(", ")}. ` +
      "Pastikan kategori cocok dengan tipe: pemasukan pakai daftar masuk, pengeluaran pakai daftar keluar. " +
      `Hari ini ${isoLocal()}. ` +
      "Hitung tanggal relatif ('kemarin','2 hari lalu','3 september') dari hari ini; " +
      "tahun memakai tahun hari ini bila tidak disebut. " +
      "tanggal format YYYY-MM-DD bila disebut, jika tidak kosongkan."
  );
}

function buildSchema(names: string[]) {
  return {
    type: Type.OBJECT,
    properties: {
      transactions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            jumlah: { type: Type.INTEGER },
            tipe: { type: Type.STRING, enum: ["masuk", "keluar"] },
            kategori: { type: Type.STRING, enum: names },
            catatan: { type: Type.STRING },
            tanggal: { type: Type.STRING },
          },
          required: ["jumlah", "tipe", "kategori"],
        },
      },
    },
    required: ["transactions"],
  };
}

function loadJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function saveJson(file: string, data: unknown): void {
  try {
    fs.writeFileSync(file, JSON.stringify(data));
  } catch (e) {
    console.error("[ai] gagal simpan", path.basename(file), (e as Error).message);
  }
}

const cache = new Map<string, { at: number; value: ParseResult[] }>();
{
  const saved = loadJson<Record<string, { at: number; value: ParseResult[] }>>(CACHE_FILE);
  if (saved) {
    const now = Date.now();
    for (const [k, v] of Object.entries(saved)) {
      if (v && now - v.at < CACHE_TTL) cache.set(k, v);
    }
  }
}

let usage: { tanggal: string; count: number } =
  loadJson<{ tanggal: string; count: number }>(USAGE_FILE) ?? { tanggal: isoLocal(), count: 0 };
if (usage.tanggal !== isoLocal()) usage = { tanggal: isoLocal(), count: 0 };

function callsToday(): number {
  if (usage.tanggal !== isoLocal()) {
    usage = { tanggal: isoLocal(), count: 0 };
    saveJson(USAGE_FILE, usage);
  }
  return usage.count;
}

function bumpUsage(): void {
  usage = { tanggal: isoLocal(), count: callsToday() + 1 };
  saveJson(USAGE_FILE, usage);
}

export interface AiStats {
  enabled: boolean;
  model: string;
  callsToday: number;
  dailyLimit: number;
  cacheSize: number;
  remaining: number;
}

export function aiStats(): AiStats {
  const calls = callsToday();
  return {
    enabled: aiEnabled,
    model: MODEL,
    callsToday: calls,
    dailyLimit: DAILY_LIMIT,
    cacheSize: cache.size,
    remaining: Math.max(0, DAILY_LIMIT - calls),
  };
}

export function aiResetUsage(): void {
  usage = { tanggal: isoLocal(), count: 0 };
  saveJson(USAGE_FILE, usage);
}

function validate(raw: unknown, allowed: Record<"masuk" | "keluar", Set<string>>): ParseResult[] {
  if (!raw || typeof raw !== "object") return [];
  const arr = (raw as { transactions?: unknown }).transactions;
  if (!Array.isArray(arr)) return [];
  const out: ParseResult[] = [];
  for (const item of arr) {
    const t = item as Record<string, unknown>;
    const jumlah = Math.round(Number(t.jumlah));
    if (!Number.isFinite(jumlah) || jumlah <= 0) continue;
    const tipe: "masuk" | "keluar" = t.tipe === "masuk" ? "masuk" : "keluar";
    const kategori = allowed[tipe].has(String(t.kategori)) ? String(t.kategori) : "Lainnya";
    const catatan = String(t.catatan ?? "").trim() || "transaksi";
    const hasil: ParseResult = { jumlah, tipe, kategori, catatan };
    const tgl = String(t.tanggal ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(tgl)) hasil.tanggal = tgl;
    out.push(hasil);
  }
  return out;
}

export async function parseGemini(text: string): Promise<ParseResult[] | null> {
  if (!aiEnabled) return null;
  const key = text.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

  if (callsToday() >= DAILY_LIMIT) {
    console.warn(`[ai] batas harian ${DAILY_LIMIT} tercapai, lewati AI.`);
    return null;
  }

  bumpUsage();

  try {
    const masukNames = categoryNames("masuk");
    const keluarNames = categoryNames("keluar");
    const union = [...new Set([...masukNames, ...keluarNames])];
    const res = await getClient().models.generateContent({
      model: MODEL,
      contents: buildPrompt(masukNames, keluarNames) + text,
      config: {
        responseMimeType: "application/json",
        responseSchema: buildSchema(union) as never,
        temperature: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });
    const parsed = JSON.parse(res.text ?? "{}");
    const list = validate(parsed, { masuk: new Set(masukNames), keluar: new Set(keluarNames) });
    if (list.length) {
      cache.set(key, { at: Date.now(), value: list });
      saveJson(CACHE_FILE, Object.fromEntries(cache));
    }
    return list.length ? list : null;
  } catch (e) {
    console.error("[ai] gagal:", (e as Error).message);
    return null;
  }
}