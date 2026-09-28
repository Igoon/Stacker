import { handleMessage } from "./bot";
import { deleteTx, type Tx } from "./db";

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const ALLOWED_CHAT = (process.env.TELEGRAM_CHAT_ID ?? "").trim();

export const telegramEnabled = TOKEN.length > 0;

const API = `https://api.telegram.org/bot${TOKEN}`;

interface TgChat { id: number }
interface TgMessage { message_id: number; chat: TgChat; text?: string }
interface TgCallback { id: string; data?: string; message?: TgMessage }
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

async function call<T>(method: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as { ok: boolean; result?: T };
    if (!j.ok) {
      console.error(`[telegram] ${method}:`, JSON.stringify(j));
      return null;
    }
    return j.result ?? null;
  } catch (e) {
    console.error(`[telegram] ${method} gagal:`, (e as Error).message);
    return null;
  }
}

function normalize(text: string): string {
  const t = text.trim();
  if (!t.startsWith("/")) return t;
  const sp = t.indexOf(" ");
  const cmd = (sp === -1 ? t : t.slice(0, sp)).replace(/^\//, "").toLowerCase();
  const rest = sp === -1 ? "" : t.slice(sp + 1);
  if (cmd === "start") return "help";
  return `${cmd} ${rest}`.trim();
}

function txLines(txs: Tx[]): string {
  if (txs.length === 0) return "";
  return (
    "\n\n" +
    txs.map((t) => `${t.tipe === "masuk" ? "+" : "-"}${t.rupiah} · ${t.kategori}${t.akun ? ` · ${t.akun}` : ""} · #${t.id}`).join("\n")
  );
}

async function send(chatId: number, text: string, txs?: Tx[]): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (txs && txs.length > 0) {
    body.reply_markup = {
      inline_keyboard: txs.map((t) => [{ text: `Hapus #${t.id}`, callback_data: `del:${t.id}` }]),
    };
  }
  await call("sendMessage", body);
}

async function sendDocument(chatId: number, name: string, content: string): Promise<void> {
  try {
    const fd = new FormData();
    fd.set("chat_id", String(chatId));
    fd.set("document", new Blob([content], { type: "text/csv" }), name);
    const res = await fetch(`${API}/sendDocument`, { method: "POST", body: fd });
    const j = (await res.json()) as { ok: boolean };
    if (!j.ok) console.error("[telegram] sendDocument:", JSON.stringify(j));
  } catch (e) {
    console.error("[telegram] sendDocument gagal:", (e as Error).message);
  }
}

function allowed(chatId: number): boolean {
  return !ALLOWED_CHAT || String(chatId) === ALLOWED_CHAT;
}

async function handleUpdate(u: TgUpdate): Promise<void> {
  if (u.callback_query) {
    const q = u.callback_query;
    const m = (q.data ?? "").match(/^del:(\d+)$/);
    if (!m || !q.message) return;

    if (!allowed(q.message.chat.id)) {
      await call("answerCallbackQuery", { callback_query_id: q.id, text: "Bot privat." });
      return;
    }
    const id = Number(m[1]);
    const ok = deleteTx(id);
    await call("answerCallbackQuery", {
      callback_query_id: q.id,
      text: ok ? `#${id} terhapus` : `#${id} tidak ada`,
    });
    if (ok) {
      await call("editMessageReplyMarkup", {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    }
    return;
  }

  const msg = u.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  if (!allowed(chatId)) {
    await send(chatId, "Bot ini privat.");
    return;
  }

  if (!ALLOWED_CHAT && !seenChats.has(chatId)) {
    seenChats.add(chatId);
    console.log(`[telegram] chat_id=${chatId} (isi TELEGRAM_CHAT_ID ini untuk kunci ke 1 orang)`);
  }

  try {
    const r = await handleMessage(normalize(msg.text));
    await send(chatId, r.text + txLines(r.txs ?? []), r.txs);
    if (r.file) await sendDocument(chatId, r.file.name, r.file.content);
  } catch (e) {
    await send(chatId, "Error: " + (e as Error).message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seenChats = new Set<number>();

let running = false;

export function startTelegram(): void {
  if (!telegramEnabled || running) return;
  running = true;

  (async () => {
    console.log("Telegram bot aktif (long polling)");
    let offset = 0;
    while (running) {
      const updates = await call<TgUpdate[]>("getUpdates", { offset, timeout: 30 });
      if (!updates) {
        await sleep(3000);
        continue;
      }
      for (const u of updates) {
        offset = u.update_id + 1;
        handleUpdate(u).catch((e) => console.error("[telegram] update gagal:", (e as Error).message));
      }
    }
  })();
}