import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiEnabled, handleMessage } from "./bot";
import { accountBalances, deleteTx, listAll, listRange, listTx, rupiah, saldo } from "./db";
import { parsePeriod } from "./dates";
import { toCSV } from "./csv";
import { startTelegram, telegramEnabled } from "./telegram";
import { startBackups } from "./backup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
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
    saldo: saldo(),
    saldoRupiah: rupiah(saldo()),
    aiEnabled,
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
  const ok = deleteTx(Number(req.params.id));
  res.json({ ok });
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

const PORT = Number(process.env.PORT ?? 3000);
const server = app.listen(PORT, () => {
  console.log(`Finance bot jalan di http://localhost:${PORT}`);
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