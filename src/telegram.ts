import { handleMessage } from "./bot";
import { deleteTx, type Tx } from "./db";
import {
  MAX_FAIL,
  PIN_RE,
  clearPin,
  endSession,
  hasPin,
  isAuthed,
  isLocked,
  lockInfoText,
  minutesLeft,
  registerFail,
  resetFail,
  sessionMinutes,
  setPin,
  startSession,
  touchSession,
  verifyPin,
} from "./security";

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const ALLOWED_CHAT = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS ?? ALLOWED_CHAT)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_ANY = (process.env.TELEGRAM_ALLOW_ANY ?? "").trim().toLowerCase() === "true";
const OWNER = ALLOWED_IDS[0] ?? "";

export const telegramEnabled = TOKEN.length > 0;

const API = `https://api.telegram.org/bot${TOKEN}`;

interface TgUser { id: number; first_name?: string; username?: string }
interface TgChat { id: number }
interface TgMessage { message_id: number; chat: TgChat; from?: TgUser; text?: string }
interface TgCallback { id: string; data?: string; from?: TgUser; message?: TgMessage }
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

async function call<T>(method: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!j.ok) {
      const d = j.description ?? "";
      if (d.includes("message is not modified") || d.includes("query is too old")) return null;
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

function parseCmd(text: string): { cmd: string; args: string } | null {
  const m = text.trim().match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: (m[2] ?? "").trim() };
}

function txLines(txs: Tx[]): string {
  if (txs.length === 0) return "";
  return (
    "\n\n" +
    txs
      .map(
        (t) =>
          `${t.tipe === "masuk" ? "+" : "-"}${t.rupiah} · ${t.kategori}${t.akun ? ` · ${t.akun}` : ""} · #${t.id}`
      )
      .join("\n")
  );
}

const sentIds = new Map<number, number[]>();

function rememberSent(chatId: number, id: number): void {
  const a = sentIds.get(chatId) ?? [];
  a.push(id);
  if (a.length > 300) a.splice(0, a.length - 300);
  sentIds.set(chatId, a);
}

async function clearChat(chatId: number): Promise<void> {
  const ids = sentIds.get(chatId) ?? [];
  sentIds.set(chatId, []);
  for (const id of ids) {
    await call("deleteMessage", { chat_id: chatId, message_id: id });
  }
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function send(chatId: number, text: string, txs?: Tx[], pre?: boolean): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (pre) {
    body.text = `<pre>${escHtml(text)}</pre>`;
    body.parse_mode = "HTML";
  }
  if (txs && txs.length > 0) {
    body.reply_markup = {
      inline_keyboard: txs.map((t) => [{ text: `Hapus #${t.id}`, callback_data: `del:${t.id}` }]),
    };
  }
  const r = await call<{ message_id: number }>("sendMessage", body);
  if (r?.message_id) rememberSent(chatId, r.message_id);
}

async function sendDocument(chatId: number, name: string, content: string): Promise<void> {
  try {
    const fd = new FormData();
    fd.set("chat_id", String(chatId));
    fd.set("document", new Blob([content], { type: "text/csv" }), name);
    const res = await fetch(`${API}/sendDocument`, { method: "POST", body: fd });
    const j = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    if (!j.ok) console.error("[telegram] sendDocument:", JSON.stringify(j));
    if (j.result?.message_id) rememberSent(chatId, j.result.message_id);
  } catch (e) {
    console.error("[telegram] sendDocument gagal:", (e as Error).message);
  }
}

type PinMode = "login" | "set" | "change_old" | "change_new" | "reset";

interface PinState {
  mode: PinMode;
  buf: string;
  msgId?: number;
}

const padStates = new Map<string, PinState>();

function mask(len: number): string {
  return "•".repeat(len) + "＿".repeat(Math.max(0, 6 - len));
}

function padText(mode: PinMode, buf: string): string {
  const head: Record<PinMode, string> = {
    login: "🔐 Masukkan PIN (6 digit):",
    set: "🔐 Buat PIN baru (6 digit):",
    change_old: "🔐 Masukkan PIN lama:",
    change_new: "🔐 Masukkan PIN baru:",
    reset: "🔐 Masukkan PIN untuk hapus:",
  };
  return `${head[mode]}\n\n${mask(buf.length)}\n\nTekan angka 0-9, lalu ✅ Masuk. PIN tidak muncul di chat.`;
}

function padKeyboard() {
  const b = (t: string, d: string) => ({ text: t, callback_data: `pk:${d}` });
  return {
    inline_keyboard: [
      [b("1", "1"), b("2", "2"), b("3", "3")],
      [b("4", "4"), b("5", "5"), b("6", "6")],
      [b("7", "7"), b("8", "8"), b("9", "9")],
      [b("⌫", "del"), b("0", "0"), b("✖", "x")],
      [b("✅ Masuk", "ok")],
    ],
  };
}

async function openKeypad(chatId: number, userId: string, mode: PinMode): Promise<void> {
  padStates.set(userId, { mode, buf: "" });
  const r = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: padText(mode, ""),
    reply_markup: padKeyboard(),
  });
  if (r?.message_id) {
    const s = padStates.get(userId);
    if (s) s.msgId = r.message_id;
    rememberSent(chatId, r.message_id);
  }
}

async function closeKeypad(chatId: number, userId: string, keepText?: string): Promise<void> {
  const s = padStates.get(userId);
  padStates.delete(userId);
  if (!s?.msgId) return;
  if (keepText) {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: s.msgId,
      text: keepText,
      reply_markup: { inline_keyboard: [] },
    });
  } else {
    await call("deleteMessage", { chat_id: chatId, message_id: s.msgId });
  }
}

async function renderKeypad(chatId: number, s: PinState): Promise<void> {
  if (!s.msgId) return;
  await call("editMessageText", {
    chat_id: chatId,
    message_id: s.msgId,
    text: padText(s.mode, s.buf),
    reply_markup: padKeyboard(),
  });
}

async function submitPin(chatId: number, userId: string, s: PinState): Promise<void> {
  const pin = s.buf;

  if (s.mode === "login" || s.mode === "reset" || s.mode === "change_old") {
    if (isLocked()) {
      await closeKeypad(chatId, userId, lockInfoText());
      return;
    }
    if (!verifyPin(pin)) {
      const res = registerFail();
      s.buf = "";
      if (res.locked) {
        await closeKeypad(chatId, userId, failText(userId, res));
      } else {
        await renderKeypad(chatId, s);
        await call("sendMessage", { chat_id: chatId, text: failText(userId, res) });
      }
      return;
    }
    resetFail();
  }

  if (s.mode === "login") {
    startSession(userId);
    await closeKeypad(chatId, userId, `Login OK. Sesi ${sessionMinutes()} menit idle.`);
    return;
  }
  if (s.mode === "set") {
    setPin(pin);
    startSession(userId);
    await closeKeypad(chatId, userId, "PIN dibuat. Kamu login sekarang.");
    return;
  }
  if (s.mode === "change_old") {
    s.mode = "change_new";
    s.buf = "";
    await renderKeypad(chatId, s);
    return;
  }
  if (s.mode === "change_new") {
    setPin(pin);
    await closeKeypad(chatId, userId, "PIN diganti.");
    return;
  }
  if (s.mode === "reset") {
    clearPin();
    endSession(userId);
    await closeKeypad(chatId, userId, "PIN dihapus. Buat PIN baru: /setpin");
    return;
  }
}

async function handleKeypad(q: TgCallback, userId: string, action: string): Promise<void> {
  const chatId = q.message!.chat.id;
  await call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});

  const s = padStates.get(userId);
  if (!s) {
    await send(chatId, "Sesi PIN berakhir. Kirim /login lagi.");
    return;
  }
  if (action === "x") {
    await closeKeypad(chatId, userId);
    return;
  }
  if (action === "del") {
    s.buf = s.buf.slice(0, -1);
    await renderKeypad(chatId, s);
    return;
  }
  if (/^\d$/.test(action)) {
    if (s.buf.length < 6) s.buf += action;
    await renderKeypad(chatId, s);
    return;
  }
  if (action === "ok") {
    if (s.buf.length === 6) {
      await submitPin(chatId, userId, s);
    } else {
      await send(chatId, `PIN harus 6 digit (sekarang ${s.buf.length}).`);
    }
  }
}

function isAllowed(userId: string, chatId: number): boolean {
  if (ALLOWED_IDS.length === 0) return ALLOW_ANY;
  if (ALLOWED_IDS.includes(userId)) return true;
  return !!ALLOWED_CHAT && String(chatId) === ALLOWED_CHAT;
}

function userLabel(from?: TgUser): string {
  if (!from) return "?";
  return `${from.first_name ?? ""}${from.username ? ` (@${from.username})` : ""}`.trim() || String(from.id);
}

async function notifyOwner(text: string): Promise<void> {
  if (!OWNER) return;
  await call("sendMessage", { chat_id: OWNER, text });
}

function failText(userId: string, res: { count: number; locked: boolean }): string {
  if (res.locked) {
    void notifyOwner(`🚨 PIN salah ${MAX_FAIL}x. Bot dikunci 15 menit.\nUser: ${userId}`);
    return "PIN salah. Terkunci 15 menit.";
  }
  return `PIN salah. Sisa ${MAX_FAIL - res.count} percobaan.`;
}

async function handleAuthCommand(
  chatId: number,
  userId: string,
  cmd: string,
  args: string
): Promise<boolean> {
  switch (cmd) {
    case "setpin": {
      if (hasPin()) {
        await send(chatId, "PIN sudah ada. Pakai /changepin.");
        return true;
      }
      if (!args) {
        await openKeypad(chatId, userId, "set");
        return true;
      }
      if (!PIN_RE.test(args)) {
        await send(chatId, "Format: /setpin 123456 (6 digit), atau kirim /setpin untuk keypad.");
        return true;
      }
      setPin(args);
      startSession(userId);
      await send(chatId, `PIN dibuat. Kamu login sekarang. Sesi ${sessionMinutes()} menit idle.`);
      return true;
    }
    case "changepin": {
      if (!hasPin()) {
        await send(chatId, "Belum ada PIN. Buat: /setpin");
        return true;
      }
      if (!args) {
        await openKeypad(chatId, userId, "change_old");
        return true;
      }
      const [oldPin, newPin] = args.split(/\s+/);
      if (!PIN_RE.test(newPin ?? "")) {
        await send(chatId, "Format: /changepin <lama> <baru>. Contoh: /changepin 111111 222222");
        return true;
      }
      if (isLocked()) {
        await send(chatId, lockInfoText());
        return true;
      }
      if (!verifyPin(oldPin ?? "")) {
        await send(chatId, failText(userId, registerFail()));
        return true;
      }
      resetFail();
      setPin(newPin);
      await send(chatId, "PIN diganti.");
      return true;
    }
    case "resetpin": {
      if (!hasPin()) {
        await send(chatId, "Belum ada PIN.");
        return true;
      }
      if (!args) {
        await openKeypad(chatId, userId, "reset");
        return true;
      }
      if (isLocked()) {
        await send(chatId, lockInfoText());
        return true;
      }
      if (!verifyPin(args)) {
        await send(chatId, failText(userId, registerFail()));
        return true;
      }
      resetFail();
      clearPin();
      endSession(userId);
      await send(chatId, "PIN dihapus. Buat PIN baru: /setpin");
      return true;
    }
    case "login": {
      if (!hasPin()) {
        await send(chatId, "Belum ada PIN. Buat: /setpin");
        return true;
      }
      if (isLocked()) {
        await send(chatId, lockInfoText());
        return true;
      }
      if (!args) {
        await openKeypad(chatId, userId, "login");
        return true;
      }
      if (!PIN_RE.test(args)) {
        await send(chatId, "Format: /login 123456 (atau kirim /login untuk keypad).");
        return true;
      }
      if (verifyPin(args)) {
        resetFail();
        startSession(userId);
        await send(chatId, `Login OK. Sesi ${sessionMinutes()} menit idle.`);
      } else {
        await send(chatId, failText(userId, registerFail()));
      }
      return true;
    }
    case "logout": {
      endSession(userId);
      await clearChat(chatId);
      const r = await call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text: "Logout. Balasan bot dibersihkan (pesanmu sendiri tidak bisa dihapus bot).",
      });
      if (r?.message_id) {
        setTimeout(() => {
          void call("deleteMessage", { chat_id: chatId, message_id: r.message_id });
        }, 5000);
      }
      return true;
    }
    default:
      return false;
  }
}

async function handleUpdate(u: TgUpdate): Promise<void> {
  if (u.callback_query) {
    const q = u.callback_query;
    const chatId = q.message?.chat.id;
    const userId = String(q.from?.id ?? chatId ?? "");
    const data = q.data ?? "";
    if (chatId == null) return;
    console.log(`[telegram] callback user=${userId} data=${data}`);

    if (!isAllowed(userId, chatId)) {
      if (shouldWarn(chatId)) {
        await call("answerCallbackQuery", { callback_query_id: q.id, text: "Bot privat." });
      }
      return;
    }

    if (data.startsWith("pk:")) {
      console.log(`[telegram] keypad ${userId} action=${data.slice(3)}`);
      await handleKeypad(q, userId, data.slice(3));
      return;
    }

    const m = data.match(/^del:(\d+)$/);
    if (!m) {
      await call("answerCallbackQuery", { callback_query_id: q.id });
      return;
    }
    if (!isAuthed(userId)) {
      await call("answerCallbackQuery", { callback_query_id: q.id, text: "Perlu login." });
      return;
    }
    const id = Number(m[1]);
    const n = deleteTx(id);
    await call("answerCallbackQuery", {
      callback_query_id: q.id,
      text: n === 0 ? `#${id} tidak ada` : n > 1 ? `#${id} + pasangan transfer terhapus` : `#${id} terhapus`,
    });
    if (n > 0) {
      await call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: q.message!.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    }
    return;
  }

  const msg = u.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const userId = String(msg.from?.id ?? chatId);
  const text = msg.text;

  if (!isAllowed(userId, chatId)) {
    if (shouldWarn(chatId)) await send(chatId, "Bot ini privat.");
    if (notifyWarn(userId)) {
      await notifyOwner(
        `🚨 Akses ditolak (user tak dikenal)\nNama: ${userLabel(msg.from)}\nUser ID: ${userId}\nChat ID: ${chatId}`
      );
    }
    return;
  }

  if (!ALLOWED_IDS.length && !seenChats.has(chatId)) {
    seenChats.add(chatId);
    console.log(
      `[telegram] user_id=${userId} chat_id=${chatId} ` +
        `(isi TELEGRAM_ALLOWED_IDS=${userId} untuk whitelist User ID)`
    );
  }

  const parsed = parseCmd(text);
  if (parsed) console.log(`[telegram] cmd ${userId}: /${parsed.cmd}`);
  if (parsed && (await handleAuthCommand(chatId, userId, parsed.cmd, parsed.args))) return;

  if (!hasPin()) {
    await send(chatId, "Bot terkunci. Buat PIN dulu: /setpin (tanpa ketik PIN).");
    return;
  }
  if (isLocked()) {
    await send(chatId, lockInfoText());
    return;
  }
  if (!isAuthed(userId)) {
    await send(chatId, `Perlu login. Kirim /login lalu tekan angka di keypad.\nSesi idle ${sessionMinutes()} menit.`);
    return;
  }
  touchSession(userId);

  try {
    const r = await handleMessage(normalize(text));
    const tail = r.txs?.length ? `\n\nSesi sisa ~${minutesLeft(userId)} menit.` : "";
    await send(chatId, r.text + txLines(r.txs ?? []) + tail, r.txs, r.pre);
    if (r.file) await sendDocument(chatId, r.file.name, r.file.content);
  } catch (e) {
    await send(chatId, "Error: " + (e as Error).message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seenChats = new Set<number>();
const warnedAt = new Map<number, number>();
const notifyAt = new Map<string, number>();

function shouldWarn(chatId: number): boolean {
  const now = Date.now();
  const last = warnedAt.get(chatId) ?? 0;
  if (now - last < 10 * 60 * 1000) return false;
  warnedAt.set(chatId, now);
  return true;
}

function notifyWarn(key: string): boolean {
  const now = Date.now();
  const last = notifyAt.get(key) ?? 0;
  if (now - last < 10 * 60 * 1000) return false;
  notifyAt.set(key, now);
  return true;
}

let running = false;

export function startTelegram(): void {
  if (!telegramEnabled || running) return;

  if (ALLOWED_IDS.length === 0 && !ALLOW_ANY) {
    console.warn(
      "[telegram] NONAKTIF demi keamanan: set TELEGRAM_CHAT_ID=<id kamu> atau " +
        "TELEGRAM_ALLOWED_IDS=<user_id,...>, atau TELEGRAM_ALLOW_ANY=true untuk izinkan siapa saja."
    );
    return;
  }

  running = true;

  (async () => {
    console.log(
      ALLOWED_IDS.length
        ? `Telegram bot aktif (whitelist: ${ALLOWED_IDS.join(", ")})`
        : "Telegram bot aktif (TERBUKA: ALLOW_ANY)"
    );
    let offset = 0;
    while (running) {
      const updates = await call<TgUpdate[]>("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });
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