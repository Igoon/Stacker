// ai.ts (mobile) — fallback Gemini via fetch REST. Tanpa SDK & tanpa node:fs.
// API key opsional, disimpan di tabel settings (bukan bundel). Cache di memori.
import { isoLocal } from "./dates";
import { categoryNames, getSetting, setSetting } from "./db";
import type { ParseResult } from "./parser";

const K_KEY = "gemini_api_key";
const K_MODEL = "gemini_model";

const DEFAULT_MODEL = "gemini-2.0-flash";
const TIMEOUT_MS = 6000;
const CACHE_TTL = 1000 * 60 * 60 * 6;
const DAILY_LIMIT = 100;

function getKey(): string {
  return (getSetting(K_KEY) ?? "").trim();
}

export function setAiKey(key: string): void {
  setSetting(K_KEY, key.trim() || null);
}

export const aiEnabled = () => getKey().length > 0;

function getModel(): string {
  return (getSetting(K_MODEL) ?? "").trim() || DEFAULT_MODEL;
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
    type: "OBJECT",
    properties: {
      transactions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            jumlah: { type: "INTEGER" },
            tipe: { type: "STRING", enum: ["masuk", "keluar"] },
            kategori: { type: "STRING", enum: names },
            catatan: { type: "STRING" },
            tanggal: { type: "STRING" },
          },
          required: ["jumlah", "tipe", "kategori"],
        },
      },
    },
    required: ["transactions"],
  };
}

const cache = new Map<string, { at: number; value: ParseResult[] }>();

let usage: { tanggal: string; count: number } = { tanggal: isoLocal(), count: 0 };

function loadUsage(): void {
  const raw = getSetting("ai_usage");
  try {
    const parsed = JSON.parse(raw ?? "null") as { tanggal: string; count: number } | null;
    if (parsed && parsed.tanggal === isoLocal()) {
      usage = parsed;
      return;
    }
  } catch {
    // abaikan
  }
  usage = { tanggal: isoLocal(), count: 0 };
}

function saveUsage(): void {
  setSetting("ai_usage", JSON.stringify(usage));
}

function callsToday(): number {
  if (usage.tanggal !== isoLocal()) {
    usage = { tanggal: isoLocal(), count: 0 };
    saveUsage();
  }
  return usage.count;
}

function bumpUsage(): void {
  usage = { tanggal: isoLocal(), count: callsToday() + 1 };
  saveUsage();
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
    enabled: aiEnabled(),
    model: getModel(),
    callsToday: calls,
    dailyLimit: DAILY_LIMIT,
    cacheSize: cache.size,
    remaining: Math.max(0, DAILY_LIMIT - calls),
  };
}

export function aiResetUsage(): void {
  usage = { tanggal: isoLocal(), count: 0 };
  saveUsage();
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
  loadUsage();
  if (!aiEnabled()) return null;

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

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${getModel()}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": getKey(),
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildPrompt(masukNames, keluarNames) + text }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: buildSchema(union),
            temperature: 0,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );

    if (!res.ok) {
      console.error("[ai] HTTP", res.status, await res.text().catch(() => ""));
      return null;
    }

    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const txt = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(txt);
    const list = validate(parsed, { masuk: new Set(masukNames), keluar: new Set(keluarNames) });
    if (list.length) {
      cache.set(key, { at: Date.now(), value: list });
    }
    return list.length ? list : null;
  } catch (e) {
    console.error("[ai] gagal:", (e as Error).message);
    return null;
  }
}
