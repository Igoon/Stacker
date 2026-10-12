import "dotenv/config";
import express from "express";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { aiEnabled, handleMessage } from "./bot";
import { aiStats } from "./ai";
import { accountBalances, deleteTx, listAll, listRange, listTx, rupiah, saldo } from "./db";
import { parsePeriod } from "./dates";
import { toCSV } from "./csv";
import { startTelegram, telegramEnabled } from "./telegram";
import { startBackups } from "./backup";
import { APP_VERSION } from "./version";

const HOST = (process.env.HOST ?? "127.0.0.1").trim();
const PORT = Number(process.env.PORT ?? 3000);
const WEB_USER = (process.env.WEB_USER ?? "admin").trim();
const WEB_PASSWORD = (process.env.WEB_PASSWORD ?? "").trim();
const WEB_MAX_FAIL = Math.max(1, Number(process.env.WEB_MAX_FAIL ?? 5));
const WEB_LOCK_MS = Math.max(1, Number(process.env.WEB_LOCK_MINUTES ?? 15)) * 60_000;

const IS_LOCAL = ["127.0.0.1", "localhost", "::1"].includes(HOST);
if (!IS_LOCAL && !WEB_PASSWORD) {
  console.error(
    `Tolak start: HOST="${HOST}" (non-lokal) tetapi WEB_PASSWORD kosong. ` +
      "Set WEB_PASSWORD, atau bind ke 127.0.0.1. Akses jauh wajib lewat VPN/HTTPS."
  );
  process.exit(1);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const webFails = new Map<string, { count: number; lockUntil: number }>();

function pruneFails(): void {
  const now = Date.now();
  for (const [ip, a] of webFails) {
    if (a.count === 0 && a.lockUntil < now) webFails.delete(ip);
  }
  if (webFails.size > 5000) webFails.clear();
}

function lockRemainMs(ip: string): number {
  const a = webFails.get(ip);
  if (!a) return 0;
  return Math.max(0, a.lockUntil - Date.now());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
});

if (WEB_PASSWORD) {
  app.use((req, res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "?";
    pruneFails();

    const remain = lockRemainMs(ip);
    if (remain > 0) {
      res.setHeader("Retry-After", String(Math.ceil(remain / 1000)));
      res.status(429).send(`Terlalu banyak percobaan. Coba lagi ${Math.ceil(remain / 60000)} menit.`);
      return;
    }

    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const i = decoded.indexOf(":");
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (safeEqual(u, WEB_USER) && safeEqual(p, WEB_PASSWORD)) {
        webFails.delete(ip);
        next();
        return;
      }
    }

    const a = webFails.get(ip) ?? { count: 0, lockUntil: 0 };
    a.count += 1;
    if (a.count >= WEB_MAX_FAIL) {
      a.lockUntil = Date.now() + WEB_LOCK_MS;
      a.count = 0;
      console.warn(`[web] IP ${ip} terkunci ${Math.round(WEB_LOCK_MS / 60000)} menit setelah ${WEB_MAX_FAIL} gagal.`);
    } else {
      console.warn(`[web] login gagal dari ${ip} (${a.count}/${WEB_MAX_FAIL}).`);
    }
    webFails.set(ip, a);

    res.setHeader("WWW-Authenticate", 'Basic realm="Finance Bot"');
    res.status(401).send("Unauthorized");
  });
}

app.use(express.static(path.join(__dirname, "..", "web")));

app.post("/api/chat", async (req, res) => {
  const msg = String(req.body?.message ?? "");
  try {
    res.json(await handleMessage(msg));
  } catch (e) {
    res.status(500).json({ text: "Error: " + (e as Error).message });
  }
});

app.get("/api/state", (_req, res) => {
  const rows = listTx(50).map((t) => ({ ...t, rupiah: rupiah(t.jumlah) }));
  res.json({
    version: APP_VERSION,
    saldo: saldo(),
    saldoRupiah: rupiah(saldo()),
    aiEnabled,
    ai: aiStats(),
    telegramEnabled,
    accounts: accountBalances().map((a) => ({
      id: a.id,
      nama: a.nama,
      tipe: a.tipe,
      saldo: a.saldo ?? 0,
      rupiah: a.rupiah,
    })),
    transactions: rows,
  });
});

app.delete("/api/transactions/:id", (req, res) => {
  const removed = deleteTx(Number(req.params.id));
  res.json({ ok: removed > 0, removed });
});

app.get("/api/csv", (req, res) => {
  const arg = String(req.query.period ?? "").trim();
  const per = arg ? parsePeriod(arg) : null;
  if (arg && !per) {
    res.status(400).json({ error: "Periode tidak dikenali" });
    return;
  }
  const rows = per ? listRange(per.from, per.to) : listAll();
  const name = `transaksi-${per ? `${per.from}_${per.to}` : "semua"}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(toCSV(rows));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Finance bot v${APP_VERSION} jalan di http://${HOST}:${PORT}`);
  console.log(
    WEB_PASSWORD
      ? `Web auth: aktif (user: ${WEB_USER}; lockout ${WEB_MAX_FAIL}x → ${Math.round(WEB_LOCK_MS / 60000)} menit)`
      : "Web auth: NONAKTIF (set WEB_PASSWORD)"
  );
  console.log(aiEnabled ? "AI fallback: aktif" : "AI fallback: nonaktif (set GEMINI_API_KEY)");
  console.log(telegramEnabled ? "Telegram: aktif" : "Telegram: nonaktif (set TELEGRAM_BOT_TOKEN)");
  startTelegram();
  startBackups();
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sudah dipakai. Mungkin bot sudah jalan. Keluar.`);
  } else {
    console.error("Server error:", e.message);
  }
  process.exit(1);
});