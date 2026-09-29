import { randomUUID } from "node:crypto";
import {
  accountBalances,
  addAccount,
  addCategory,
  addTx,
  deleteAccount,
  deleteAllTx,
  deleteCategory,
  deleteTx,
  getAccountByName,
  getCategoryByName,
  listAccounts,
  listAll,
  listCategories,
  listRange,
  listTx,
  ringkasRange,
  reconcileAccount,
  rupiah,
  rupiahSigned,
  saldo,
  setAccountSaldoAwal,
  updateCategoryKeywords,
  updateTx,
  type Account,
  type Tx,
} from "./db";
import { parseLocal, type ParseResult } from "./parser";
import { parsePeriod } from "./dates";
import { toCSV } from "./csv";
import { backupTagged } from "./backup";
import { aiEnabled, aiResetUsage, aiStats, parseGemini } from "./ai";
import { APP_VERSION } from "./version";

export interface Reply {
  text: string;
  txs?: Tx[];
  file?: { name: string; content: string };
}

const TIPE_AKUN = ["bank", "ewallet", "cash"];

const HELP =
  `Duit Bot v${APP_VERSION}\n\n` +
  "Catat transaksi:\n" +
  "  makan siang 50rb\n" +
  "  gaji 5jt\n" +
  "  parkir 5rb sama kopi 18rb   (banyak sekaligus)\n" +
  "  gopay makan 50rb            (akun di depan)\n" +
  "  makan 50rb @bca             (akun pakai @)\n" +
  "  kemarin makan 50rb          (tanggal relatif)\n" +
  "  tgl 3 bayar kos 1jt\n" +
  "  3 september jajan 20rb\n" +
  "  2026-09-03 jajan 20rb       (tanggal ISO)\n\n" +
  "Transfer:\n" +
  "  transfer 100rb bsi ke gopay\n\n" +
  "Saldo:\n" +
  "  saldo                       (total + semua akun)\n" +
  "  saldo bsi                   (satu akun)\n\n" +
  "Akun:\n" +
  "  akun\n" +
  "  akun tambah seabank bank saldo 1jt\n" +
  "  akun hapus seabank\n" +
  "  saldo awal bsi 45.001.889\n" +
  "  sesuaikan bsi 100jt         (paksa saldo ke nilai nyata)\n" +
  "  ubah 1 akun bsi             (pindah tx ke akun)\n\n" +
  "Kategori:\n" +
  "  kategori\n" +
  "  kategori tambah Sedekah | sedekah, donasi, zakat\n" +
  "  kategori ubah Sedekah | sedekah, donasi, zakat\n" +
  "  kategori hapus Sedekah\n\n" +
  "Laporan & export:\n" +
  "  laporan | laporan september | laporan minggu lalu\n" +
  "  csv | csv september\n\n" +
  "Kelola:\n" +
  "  riwayat\n" +
  "  ubah 3 jadi 60rb\n" +
  "  hapus 3\n" +
  "  ai | ai reset               (pemakaian AI)\n" +
  "  versi                       (versi aplikasi)\n" +
  "  reset transaksi            (hapus semua, ada backup)\n" +
  "  help\n\n" +
  "Keamanan (Telegram):\n" +
  "  /login                     (keypad angka, PIN tak tampil di chat)\n" +
  "  /logout                    (bersihkan balasan bot + keluar)\n" +
  "  /setpin                    (keypad buat PIN)\n" +
  "  /changepin                 (keypad ganti PIN)\n" +
  "  /resetpin                  (keypad hapus PIN)\n\n" +
  "Nominal: 50rb, 1,5jt, 50000, 45.001.889\n" +
  "Periode: september, 2026-08, minggu ini, minggu lalu, bulan lalu, tahun ini, hari ini, kemarin";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function mentionedAccounts(text: string): { acc: Account; index: number }[] {
  const low = text.toLowerCase();
  const out: { acc: Account; index: number }[] = [];
  for (const acc of listAccounts()) {
    const re = new RegExp(`(^|\\s)@?${escapeRe(acc.nama.toLowerCase())}(?=\\s|$)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(low))) out.push({ acc, index: m.index + m[1].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

function resolveAccount(text: string): Account | undefined {
  const found = mentionedAccounts(text);
  if (found.length > 0) return found[0].acc;
  return getAccountByName("Cash") ?? listAccounts()[0];
}

const withRupiah = (t: Tx): Tx => ({ ...t, rupiah: rupiah(t.jumlah) });

function parseAmount(raw: string): number | undefined {
  const p = parseLocal(raw);
  if (p) return p.result.jumlah;
  const m = raw.match(/\d[\d.,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export async function handleMessage(input: string): Promise<Reply> {
  const text = input.trim();
  const low = text.toLowerCase();

  if (!text) return { text: "Tulis sesuatu, contoh: makan siang 50rb" };
  if (["help", "bantuan", "?"].includes(low)) return { text: HELP };

  if (["versi", "version", "v"].includes(low)) return { text: `Duit Bot v${APP_VERSION}` };

  if (low === "ai reset") {
    aiResetUsage();
    return { text: "Counter AI direset." };
  }

  if (low === "ai" || low === "ai info") {
    const s = aiStats();
    return {
      text:
        `AI: ${s.enabled ? "aktif" : "nonaktif"}\n` +
        `Model: ${s.model}\n` +
        `Panggilan hari ini: ${s.callsToday} / ${s.dailyLimit} (sisa ${s.remaining})\n` +
        `Cache: ${s.cacheSize} entri\n\n` +
        "Catatan: pesan yang diproses lokal tidak memakai AI.",
    };
  }

  if (/^reset\s+(transaksi|laporan|semua)$/i.test(text)) {
    const bkp = await backupTagged("pre-reset").catch(() => null);
    const n = deleteAllTx();
    const tail = bkp ? `\nBackup: ${bkp.split(/[\\/]/).pop()}` : "";
    return { text: `Semua transaksi dihapus (${n}). Saldo kini = saldo awal tiap akun.${tail}` };
  }

  if ((low === "saldo" || low.startsWith("saldo ")) && !/^saldo\s+awal\b/.test(low)) {
    const arg = text.replace(/^saldo\s*/i, "").trim();
    if (!arg) {
      const rows = accountBalances();
      const total = saldo();
      const lines = rows.map((a) => `  ${a.nama}: ${rupiahSigned(a.saldo ?? 0)}`).join("\n");
      return { text: `Saldo total: ${rupiahSigned(total)}\n${lines}` };
    }
    const acc = getAccountByName(arg);
    if (!acc) return { text: `Akun "${arg}" tidak ada. Lihat: \`akun\`` };
    return { text: `Saldo ${acc.nama}: ${rupiahSigned(saldo(acc.id))}` };
  }

  let m: RegExpMatchArray | null;

  if (low === "akun" || low === "akun list" || low === "daftar akun") {
    const rows = accountBalances();
    return {
      text:
        "Akun:\n" +
        rows.map((a) => `  #${a.id} ${a.nama} (${a.tipe}) · ${rupiahSigned(a.saldo ?? 0)}`).join("\n"),
    };
  }

  if ((m = text.match(/^akun tambah\s+(.+)$/i))) {
    const rest = m[1].trim();
    const saldoPart = rest.match(/\bsaldo\s+(.+)$/i);
    const before = saldoPart ? rest.slice(0, saldoPart.index).trim() : rest;
    const toks = before.split(/\s+/);
    const nama = toks[0];
    const tipeRaw = (toks[1] ?? "ewallet").toLowerCase();
    const tipe = TIPE_AKUN.includes(tipeRaw) ? tipeRaw : "ewallet";
    if (!nama) return { text: "Format: `akun tambah <nama> <bank|ewallet|cash> [saldo 1jt]`" };
    if (getAccountByName(nama)) return { text: `Akun "${nama}" sudah ada.` };
    const awal = saldoPart ? parseLocal(saldoPart[1])?.result.jumlah ?? 0 : 0;
    const acc = addAccount(nama, tipe, awal);
    return { text: `Akun ${acc.nama} (${acc.tipe}) ditambah.` };
  }

  if ((m = text.match(/^akun hapus\s+(.+)$/i))) {
    const acc = getAccountByName(m[1]);
    if (!acc) return { text: `Akun "${m[1]}" tidak ada.` };
    deleteAccount(acc.id);
    return { text: `Akun ${acc.nama} dihapus. Transaksinya tetap ada tanpa akun.` };
  }

  if (low === "kategori" || low === "kategori list" || low === "kategori daftar") {
    const cats = listCategories();
    return {
      text:
        "Kategori:\n" +
        cats
          .map((c) => `  #${c.id} ${c.nama}${c.keywords.length ? ` (${c.keywords.join(", ")})` : ""}`)
          .join("\n") +
        "\n\nTambah: `kategori tambah Sedekah | sedekah, donasi, zakat, infak`",
    };
  }

  if ((m = text.match(/^kategori tambah\s+(.+)$/i))) {
    const rest = m[1].trim();
    const pipe = rest.indexOf("|");
    const nama = (pipe === -1 ? rest : rest.slice(0, pipe)).trim();
    const kwRaw = pipe === -1 ? "" : rest.slice(pipe + 1).trim();
    if (!nama) return { text: "Format: `kategori tambah <nama> | kata kunci, dipisah, koma`" };
    const keywords = kwRaw
      ? kwRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [nama.toLowerCase()];
    const existing = getCategoryByName(nama);
    if (existing) {
      const merged = [...new Set([...existing.keywords, ...keywords])];
      updateCategoryKeywords(existing.id, merged);
      return { text: `Kategori ${existing.nama} diperbarui. Kata kunci: ${merged.join(", ")}` };
    }
    addCategory(nama, keywords);
    return { text: `Kategori ${nama} ditambah. Kata kunci: ${keywords.join(", ")}` };
  }

  if ((m = text.match(/^kategori ubah\s+(.+)$/i))) {
    const rest = m[1].trim();
    const pipe = rest.indexOf("|");
    const nama = (pipe === -1 ? rest : rest.slice(0, pipe)).trim();
    const kwRaw = pipe === -1 ? "" : rest.slice(pipe + 1).trim();
    const cat = getCategoryByName(nama);
    if (!cat) return { text: `Kategori "${nama}" tidak ada. Buat: \`kategori tambah ${nama} | kws\`` };
    const keywords = kwRaw
      ? kwRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [nama.toLowerCase()];
    updateCategoryKeywords(cat.id, keywords);
    return { text: `Kata kunci ${cat.nama} diganti: ${keywords.join(", ")}` };
  }

  if ((m = text.match(/^kategori hapus\s+(.+)$/i))) {
    const cat = getCategoryByName(m[1]);
    if (!cat) return { text: `Kategori "${m[1]}" tidak ada.` };
    deleteCategory(cat.id);
    return { text: `Kategori ${cat.nama} dihapus. Transaksi lama tetap ada.` };
  }

  if ((m = text.match(/^saldo awal\s+(.+)$/i))) {
    const parts = m[1].trim().split(/\s+/);
    const nominalRaw = parts.filter((p) => /\d/.test(p)).join(" ");
    const nama = parts[0];
    const acc = getAccountByName(nama);
    if (!acc) return { text: `Akun "${nama}" tidak ada.` };
    const nominal = parseAmount(nominalRaw);
    if (nominal == null) return { text: "Contoh: `saldo awal bca 5jt`" };
    setAccountSaldoAwal(acc.id, nominal);
    return { text: `Saldo awal ${acc.nama} = ${rupiahSigned(nominal)}.` };
  }

  if ((m = text.match(/^(?:sesuaikan|betulkan)\s+(?:saldo\s+)?(\S+?)(?:\s+ke)?\s+([\d][\d.,]*(?:\s*(?:jt|juta|rb|ribu|k))?)$/i))) {
    const acc = getAccountByName(m[1]);
    if (!acc) return { text: `Akun "${m[1]}" tidak ada. Lihat: \`akun\`` };
    const target = parseAmount(m[2]);
    if (target == null) return { text: "Nominal tidak kebaca. Contoh: `sesuaikan bsi 100jt`" };
    const awal = reconcileAccount(acc.id, target);
    return {
      text:
        `Saldo ${acc.nama} kini ${rupiahSigned(target)}\n` +
        `(saldo awal diset ${rupiahSigned(awal)}, total transaksi ${rupiahSigned(target - awal)})`,
    };
  }

  if (/^(?:sesuaikan|betulkan)\b/.test(low)) {
    return { text: "Format: `sesuaikan <akun> <nominal>`. Contoh: `sesuaikan bsi 100jt`" };
  }

  if (/^transfer\b/.test(low)) {
    const found = mentionedAccounts(text);
    const nominal = parseLocal(text)?.result.jumlah;
    if (found.length < 2) {
      return { text: "Sebut dua akun. Contoh: `transfer 100rb bca ke gopay`" };
    }
    if (!nominal) return { text: "Nominal tidak kebaca. Contoh: `transfer 100rb bca ke gopay`" };
    const from = found[0].acc;
    const to = found[1].acc;
    if (from.id === to.id) return { text: "Akun asal dan tujuan sama." };
    const g = randomUUID();
    const keluar = addTx({
      jumlah: nominal,
      tipe: "keluar",
      kategori: "Transfer",
      catatan: `Transfer ke ${to.nama}`,
      account_id: from.id,
      transfer_id: g,
    });
    const masuk = addTx({
      jumlah: nominal,
      tipe: "masuk",
      kategori: "Transfer",
      catatan: `Transfer dari ${from.nama}`,
      account_id: to.id,
      transfer_id: g,
    });
    return {
      text: `Transfer ${rupiah(nominal)}: ${from.nama} → ${to.nama}`,
      txs: [keluar, masuk].map(withRupiah),
    };
  }

  if (/^(laporan|ringkasan|report)\b/.test(low)) {
    const arg = text.replace(/^\s*(laporan|ringkasan|report)\s*/i, "").trim();
    const per = parsePeriod(arg);
    if (!per) {
      return {
        text: "Periode tidak dikenali. Contoh: `laporan september`, `laporan minggu lalu`, `laporan 2026-08`.",
      };
    }
    const rows = ringkasRange(per.from, per.to);
    if (rows.length === 0) return { text: `Belum ada transaksi ${per.label}.` };
    const masuk = rows.filter((r) => r.tipe === "masuk");
    const keluar = rows.filter((r) => r.tipe === "keluar");
    const fmt = (rs: typeof rows) => rs.map((r) => `  ${r.kategori}: ${rupiah(r.total)}`).join("\n");
    const tMasuk = masuk.reduce((a, b) => a + b.total, 0);
    const tKeluar = keluar.reduce((a, b) => a + b.total, 0);
    return {
      text:
        `Ringkasan ${per.label}\n\nMasuk (${rupiah(tMasuk)})\n${fmt(masuk) || "  -"}\n\n` +
        `Keluar (${rupiah(tKeluar)})\n${fmt(keluar) || "  -"}\n\nSelisih: ${rupiahSigned(tMasuk - tKeluar)}`,
    };
  }

  if ((m = low.match(/^hapus\s+(\d+)$/))) {
    const id = Number(m[1]);
    const n = deleteTx(id);
    if (!n) return { text: `Id ${id} tidak ada.` };
    return { text: n > 1 ? `Terhapus #${id} + pasangan transfer (${n} entri).` : `Terhapus #${id}.` };
  }

  if ((m = low.match(/^ubah\s+(\d+)\s+akun\s+(.+)$/))) {
    const id = Number(m[1]);
    const acc = getAccountByName(m[2]);
    if (!acc) return { text: `Akun "${m[2]}" tidak ada. Lihat: \`akun\`` };
    const tx = updateTx(id, { account_id: acc.id });
    return tx
      ? { text: `#${id} dipindah ke ${acc.nama}.`, txs: [withRupiah(tx)] }
      : { text: `Id ${id} tidak ada.` };
  }

  if ((m = low.match(/^ubah\s+(\d+)\s+jadi\s+(.+)$/))) {
    const id = Number(m[1]);
    const p = parseLocal(m[2]);
    if (!p) return { text: "Nominal baru tidak kebaca. Contoh: `ubah 3 jadi 60rb`" };
    const tx = updateTx(id, {
      jumlah: p.result.jumlah,
      tipe: p.result.tipe,
      kategori: p.result.kategori,
    });
    return tx ? { text: "Diperbarui.", txs: [withRupiah(tx)] } : { text: `Id ${id} tidak ada.` };
  }

  if (["riwayat", "history", "list"].includes(low)) {
    const rows = listTx(10);
    if (rows.length === 0) return { text: "Belum ada transaksi." };
    return {
      text:
        "10 transaksi terakhir:\n" +
        rows
          .map(
            (r) =>
              `#${r.id} ${r.tipe === "masuk" ? "+" : "-"}${rupiah(r.jumlah)} ${r.kategori}` +
              (r.akun ? ` · ${r.akun}` : "")
          )
          .join("\n"),
    };
  }

  if (/^(csv|export)\b/.test(low)) {
    const arg = text.replace(/^\s*(csv|export)\s*/i, "").trim();
    const per = arg ? parsePeriod(arg) : null;
    if (arg && !per) return { text: "Periode tidak dikenali. Contoh: `csv september`, `csv 2026`." };
    const rows = per ? listRange(per.from, per.to) : listAll();
    if (rows.length === 0) return { text: `Tidak ada transaksi${per ? ` ${per.label}` : ""}.` };
    const name = `transaksi-${per ? `${per.from}_${per.to}` : "semua"}.csv`;
    return {
      text: `CSV ${rows.length} transaksi (${per ? per.label : "semua"}).`,
      file: { name, content: toCSV(rows) },
    };
  }

  const account = resolveAccount(text);
  const { results, usedAI } = await resolveTransactions(text);
  if (results.length === 0) {
    return { text: "Nominal tidak kebaca. Contoh: `makan siang 50rb`" };
  }

  const txs = results.map((p) =>
    addTx({
      jumlah: p.jumlah,
      tipe: p.tipe,
      kategori: p.kategori,
      catatan: p.catatan,
      tanggal: p.tanggal,
      account_id: account?.id ?? null,
    })
  );
  const total = txs.reduce((a, t) => a + (t.tipe === "masuk" ? t.jumlah : -t.jumlah), 0);
  const akunLabel = account ? ` · ${account.nama}` : "";
  const head =
    txs.length > 1
      ? `${txs.length} transaksi tercatat${akunLabel} (total ${total >= 0 ? "+" : "-"}${rupiah(total)}).`
      : `Tercatat${akunLabel}.`;
  return { text: usedAI ? `${head}\n(diproses AI)` : head, txs: txs.map(withRupiah) };
}

async function resolveTransactions(
  text: string
): Promise<{ results: ParseResult[]; usedAI: boolean }> {
  const local = parseLocal(text);

  if (local && local.confidence === "high") {
    return { results: [local.result], usedAI: false };
  }

  const ai = await parseGemini(text);
  if (ai && ai.length > 0) return { results: ai, usedAI: true };

  if (local) return { results: [local.result], usedAI: false };
  return { results: [], usedAI: false };
}

export { aiEnabled };
