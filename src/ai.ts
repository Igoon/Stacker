// ai.ts (mobile) — fallback AI: Gemini (default, gratis) atau OpenAI-compatible
// (Ollama lokal / Groq / OpenRouter / dll). Tanpa SDK, tanpa node:fs.
// API key opsional, disimpan di tabel settings (bukan bundel). Cache di memori.
import { isoLocal } from "./dates";
import { categoryNames, getSetting, setSetting } from "./db";
import type { ParseResult } from "./parser";

const K_PROVIDER = "ai_provider";
const K_MODEL = "ai_model";
const K_BASE = "ai_base_url";
const K_KEY = "ai_key";

const DEFAULT_MODEL_GEMINI = "gemini-2.0-flash";
const DEFAULT_BASE_OPENAI = "http://localhost:11434/v1";

const TIMEOUT_MS = 6000;
const CACHE_TTL = 1000 * 60 * 60 * 6;
const DAILY_LIMIT = 100;

export type AiProvider = "gemini" | "openai";

export interface AiConfig {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  key: string;
}

function getConfig(): AiConfig {
  const provider: AiProvider = getSetting(K_PROVIDER) === "openai" ? "openai" : "gemini";
  const model =
    (getSetting(K_MODEL) ?? "").trim() || (provider === "gemini" ? DEFAULT_MODEL_GEMINI : "");
  const baseUrl = (getSetting(K_BASE) ?? "").trim() || DEFAULT_BASE_OPENAI;
  const key = (getSetting(K_KEY) ?? "").trim();
  return { provider, model, baseUrl, key };
}

export function getAiConfig(): AiConfig {
  return getConfig();
}

export function setAiConfig(cfg: Partial<AiConfig>): void {
  if (cfg.provider != null) setSetting(K_PROVIDER, cfg.provider);
  if (cfg.model != null) setSetting(K_MODEL, cfg.model.trim() || null);
  if (cfg.baseUrl != null) setSetting(K_BASE, cfg.baseUrl.trim() || null);
  if (cfg.key != null) setSetting(K_KEY, cfg.key.trim() || null);
}

export const aiEnabled = (): boolean => {
  const c = getConfig();
  if (c.provider === "gemini") return c.key.length > 0;
  // OpenAI-compatible hanya aktif kalau base URL disimpan eksplisit (atau key
  // diisi). Jangan diam-diam memakai default localhost -> timeout 6 dtk.
  return !!(getSetting(K_BASE) ?? "").trim() || c.key.length > 0;
};

const SYSTEM_PROMPT =
  "Kamu parser transaksi keuangan berbahasa Indonesia. " +
  "Ubah pesan user jadi daftar transaksi. Pisahkan bila ada beberapa transaksi. " +
  "Nominal dalam Rupiah, integer, tanpa titik. Contoh: '50rb'=50000, '1,5jt'=1500000. " +
  "tipe 'masuk' untuk pemasukan (gaji, bonus, terima uang), selain itu 'keluar'. " +
  "catatan = teks singkat transaksi. tanggal format YYYY-MM-DD bila disebut, jika tidak kosongkan.";

function buildPrompt(masuk: string[], keluar: string[]): string {
  return (
    SYSTEM_PROMPT +
    `\nKategori MASUK wajib salah satu dari: ${masuk.join(", ")}. ` +
    `Kategori KELUAR wajib salah satu dari: ${keluar.join(", ")}. ` +
    "Pastikan kategori cocok dengan tipe: pemasukan pakai daftar masuk, pengeluaran pakai daftar keluar. " +
    `Hari ini ${isoLocal()}. ` +
    "Hitung tanggal relatif ('kemarin','2 hari lalu','3 september') dari hari ini; " +
    "tahun memakai tahun hari ini bila tidak disebut. " +
    "tanggal format YYYY-MM-DD bila disebut, jika tidak kosongkan."
  );
}

const JSON_INSTRUCTION =
  '\n\nJawab HANYA satu objek JSON valid tanpa markdown, format persis:\n' +
  '{"transactions":[{"jumlah":50000,"tipe":"keluar","kategori":"Makanan","catatan":"makan siang","tanggal":""}]}';

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
let usageLoaded = false;

function loadUsage(): void {
  usageLoaded = true;
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
  if (!usageLoaded) loadUsage();
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
  provider: AiProvider;
  model: string;
  baseUrl: string;
  callsToday: number;
  dailyLimit: number;
  cacheSize: number;
  remaining: number;
}

export function aiStats(): AiStats {
  const c = getConfig();
  const calls = callsToday();
  return {
    enabled: aiEnabled(),
    provider: c.provider,
    model: c.model,
    baseUrl: c.baseUrl,
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

function extractJson(s: string): unknown {
  const t = s.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
  return JSON.parse(body);
}

async function callGemini(
  cfg: AiConfig,
  masuk: string[],
  keluar: string[],
  union: string[],
  text: string
): Promise<unknown> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model || DEFAULT_MODEL_GEMINI}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cfg.key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(masuk, keluar) + "\n\n" + text }] }],
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
    throw new Error(`gemini HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const txt = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(txt);
}

async function callOpenAi(
  cfg: AiConfig,
  masuk: string[],
  keluar: string[],
  text: string
): Promise<unknown> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.key) headers["Authorization"] = `Bearer ${cfg.key}`;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: buildPrompt(masuk, keluar) + JSON_INSTRUCTION },
        { role: "user", content: text },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error("[ai] HTTP", res.status, await res.text().catch(() => ""));
    throw new Error(`openai HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const txt = j.choices?.[0]?.message?.content ?? "{}";
  return extractJson(txt);
}

export async function parseGemini(text: string): Promise<ParseResult[] | null> {
  loadUsage();
  if (!aiEnabled()) return null;

  const cfg = getConfig();
  const cacheKey = `${cfg.provider}|${cfg.model}|${text.trim().toLowerCase()}`;
  const hit = cache.get(cacheKey);
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

    const raw =
      cfg.provider === "gemini"
        ? await callGemini(cfg, masukNames, keluarNames, union, text)
        : await callOpenAi(cfg, masukNames, keluarNames, text);

    const list = validate(raw, { masuk: new Set(masukNames), keluar: new Set(keluarNames) });
    if (list.length) {
      cache.set(cacheKey, { at: Date.now(), value: list });
    }
    return list.length ? list : null;
  } catch (e) {
    console.error("[ai] gagal:", (e as Error).message);
    return null;
  }
}
