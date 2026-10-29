// randomUUID dari crypto global (tersedia di browser & worker).
import {
  accountBalances,
  addAccount,
  addCategory,
  addTx,
  deleteAccount,
  deleteAllTx,
  deleteCategory,
  deleteTx,
  dailySeries,
  getAccountByName,
  getBudget,
  getCategoryByName,
  getTx,
  listAccounts,
  listAll,
  listBudgets,
  listCategories,
  listRange,
  listTx,
  ringkasRange,
  reconcileAccount,
  rupiah,
  rupiahSigned,
  saldo,
  searchTx,
  setAccountSaldoAwal,
  setBudget,
  setCategoryTipe,
  transferRange,
  updateCategoryKeywords,
  updateTx,
  deleteBudget,
  type Account,
  type Tx,
} from "./db";
import { parseLocal, MASUK, type ParseResult } from "./parser";
import { parsePeriod, type Period } from "./dates";
import { toCSV } from "./csv";
import { buildDailyRange, buildGrafik, shortRp } from "./chart";
import { backupTagged } from "./backup";
import { aiEnabled, aiResetUsage, aiStats, parseGemini } from "./ai";
import { APP_VERSION } from "./version";

export interface Reply {
  text: string;
  txs?: Tx[];
  file?: { name: string; content: string };
  pre?: boolean;
}

const TIPE_AKUN = ["bank", "ewallet", "cash"];

const HELP =
  `Stacker v${APP_VERSION}\n\n` +
  "Catat transaksi:\n" +
  "  makan siang 50rb\n" +
  "  gaji 5jt\n" +
  "  parkir 5rb sama kopi 18rb   (banyak sekaligus)\n" +
  "  gopay makan 50rb            (akun di depan)\n" +
  "  makan 50rb @bca             (akun pakai @)\n" +
  "  kemarin makan 50rb          (tanggal relatif)\n" +
  "  tgl 3 bayar kos 1jt\n" +
  "  3 september jajan 20rb\n" +
  "  2026-09-03 jajan 20rb       (tanggal ISO)\n" +
  "  terima sedekah 1jt bsi      (arah masuk)\n" +
  "  bsi sedekah 1jt             (arah keluar)\n\n" +
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
  "  (arah: terima/masuk/dapat/gaji/bunga = masuk; lain = keluar)\n" +
  "  kategori\n" +
  "  kategori tambah masuk Bunga | bunga, dividen\n" +
  "  kategori tambah keluar Sedekah | sedekah, donasi\n" +
  "  kategori tambah keduanya Sedekah | sedekah\n" +
  "  kategori sisi Sedekah keduanya\n" +
  "  kategori tambahkata Sedekah | infak\n" +
  "  kategori hapuskata Sedekah | zakat\n" +
  "  kategori ubah Sedekah | sedekah, donasi, zakat\n" +
  "  kategori hapus Sedekah\n\n" +
  "Laporan & export:\n" +
  "  laporan | laporan september | laporan gopay september\n" +
  "  grafik | grafik september | grafik gopay\n" +
  "  csv | csv september | csv gopay\n\n" +
  "Anggaran:\n" +
  "  anggaran | anggaran Makanan 2jt | anggaran hapus Makanan\n\n" +
  "Cari:\n" +
  "  cari kopi\n" +
  "  cari jimpitan bsi\n" +
  "  cari kopi september 50          (50 = jumlah hasil)\n" +
  "  lihat 12\n\n" +
  "Kelola:\n" +
  "  riwayat | riwayat 30\n" +
  "  ubah 3 jadi 60rb\n" +
  "  hapus 3\n" +
  "  hapus 24 25                 (beberapa sekaligus, boleh #24)\n" +
  "  ai | ai reset               (pemakaian AI)\n" +
  "  versi                       (versi aplikasi)\n" +
  "  reset transaksi            (hapus semua, ada backup)\n" +
  "  help\n\n" +
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

function monthSpent(kategori: string): number {
  const per = parsePeriod("");
  if (!per) return 0;
  const k = kategori.toLowerCase();
  return ringkasRange(per.from, per.to)
    .filter((r) => r.tipe === "keluar" && r.kategori.toLowerCase() === k)
    .reduce((a, b) => a + b.total, 0);
}

function budgetWarn(t: Tx): string | null {
  if (t.tipe !== "keluar") return null;
  const budget = getBudget(t.kategori);
  if (budget == null || budget <= 0) return null;
  const spent = monthSpent(t.kategori);
  const prev = spent - t.jumlah;
  if (prev < budget && spent >= budget) {
    return `⚠️ Anggaran ${t.kategori} tembus: ${rupiah(spent)} / ${rupiah(budget)}`;
  }
  if (prev < budget * 0.8 && spent >= budget * 0.8) {
    return `⚠️ Anggaran ${t.kategori} ${Math.floor((spent / budget) * 100)}%: ${rupiah(spent)} / ${rupiah(budget)}`;
  }
  return null;
}

interface Filter {
  account?: Account;
  per?: Period;
  query: string;
}

function parseFilter(arg: string): Filter {
  let rest = ` ${arg} `.replace(/\s+/g, " ");
  const account = mentionedAccounts(rest)[0]?.acc;
  if (account) {
    rest = rest.replace(new RegExp(`(^|\\s)@?${escapeRe(account.nama)}(?=\\s|$)`, "i"), " ");
  }
  rest = rest.trim();

  let per: Period | undefined;
  let query = rest;
  if (rest) {
    const whole = parsePeriod(rest);
    if (whole) {
      per = whole;
      query = "";
    } else {
      const toks = rest.split(/\s+/);
      for (let n = Math.min(2, toks.length); n >= 1; n--) {
        const cand = toks.slice(toks.length - n).join(" ");
        const pp = parsePeriod(cand);
        if (pp) {
          per = pp;
          query = toks.slice(0, toks.length - n).join(" ");
          break;
        }
      }
    }
  }
  return { account, per, query };
}

const txLine = (r: Tx) =>
  `#${r.id} ${r.tanggal} ${r.tipe === "masuk" ? "+" : "-"}${rupiah(r.jumlah)} ${r.kategori}` +
  (r.akun ? ` · ${r.akun}` : "");

export async function handleMessage(input: string): Promise<Reply> {
  const text = input.trim();
  const low = text.toLowerCase();

  if (!text) return { text: "Tulis sesuatu, contoh: makan siang 50rb" };
  if (["help", "bantuan", "?"].includes(low)) return { text: HELP };

  if (["versi", "version", "v"].includes(low)) return { text: `Stacker v${APP_VERSION}` };

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
    const grp = (tipe: string) => cats.filter((c) => c.tipe === tipe || c.tipe === "keduanya");
    const fmt = (rs: typeof cats) =>
      rs.map((c) => `  #${c.id} ${c.nama}${c.keywords.length ? ` (${c.keywords.join(", ")})` : ""}`).join("\n") || "  -";
    return {
      text:
        "Kategori:\n\nMasuk:\n" +
        fmt(grp("masuk")) +
        "\n\nKeluar:\n" +
        fmt(grp("keluar")) +
        "\n\nTambah: `kategori tambah masuk Bunga | bunga, dividen` · `kategori tambah keluar Sedekah | sedekah`\n" +
        "Dua arah: `kategori tambah keduanya Sedekah | sedekah`\n" +
        "Pindah sisi: `kategori sisi Sedekah keduanya`\n" +
        "Kata kunci: `kategori tambahkata Sedekah | infak` · `kategori hapuskata Sedekah | zakat`",
    };
  }

  if ((m = text.match(/^kategori tambahkata\s+(.+)$/i))) {
    const rest = m[1].trim();
    const pipe = rest.indexOf("|");
    const nama = (pipe === -1 ? rest : rest.slice(0, pipe)).trim();
    const kwRaw = pipe === -1 ? "" : rest.slice(pipe + 1).trim();
    const cat = getCategoryByName(nama);
    if (!cat) return { text: `Kategori "${nama}" tidak ada. Buat: \`kategori tambah ${nama}\`` };
    const add = kwRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!add.length) return { text: "Format: `kategori tambahkata Sedekah | zakat, infak`" };
    const merged = [...new Set([...cat.keywords, ...add])];
    updateCategoryKeywords(cat.id, merged);
    const added = add.filter((k) => !cat.keywords.includes(k));
    return {
      text:
        `${cat.nama}: +${added.length} kata kunci${added.length ? ` (${added.join(", ")})` : " (tidak ada baru)"}\n` +
        `Kata kunci: ${merged.join(", ")}`,
    };
  }

  if ((m = text.match(/^kategori hapuskata\s+(.+)$/i))) {
    const rest = m[1].trim();
    const pipe = rest.indexOf("|");
    const nama = (pipe === -1 ? rest : rest.slice(0, pipe)).trim();
    const kwRaw = pipe === -1 ? "" : rest.slice(pipe + 1).trim();
    const cat = getCategoryByName(nama);
    if (!cat) return { text: `Kategori "${nama}" tidak ada.` };
    const del = kwRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!del.length) return { text: "Format: `kategori hapuskata Sedekah | zakat`" };
    const remaining = cat.keywords.filter((k) => !del.includes(k));
    updateCategoryKeywords(cat.id, remaining);
    const removed = del.filter((k) => cat.keywords.includes(k));
    return {
      text:
        `${cat.nama}: -${removed.length} kata kunci${removed.length ? ` (${removed.join(", ")})` : " (tidak ada yang cocok)"}\n` +
        `Kata kunci: ${remaining.join(", ") || "-"}`,
    };
  }

  if ((m = text.match(/^kategori tambah\s+(.+)$/i))) {
    const rest = m[1].trim();
    const pipe = rest.indexOf("|");
    let head = (pipe === -1 ? rest : rest.slice(0, pipe)).trim();
    const kwRaw = pipe === -1 ? "" : rest.slice(pipe + 1).trim();
    let tipe: string | undefined;
    const words = head.split(/\s+/).filter(Boolean);
    for (const t of ["masuk", "keluar", "keduanya"]) {
      if (words.includes(t)) {
        tipe = t;
        head = words.filter((w) => w !== t).join(" ").trim();
        break;
      }
    }
    const nama = head;
    if (!nama) return { text: "Format: `kategori tambah [masuk|keluar|keduanya] <nama> | kata kunci`" };
    const keywords = kwRaw
      ? kwRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [nama.toLowerCase()];
    if (!tipe) tipe = keywords.some((k) => MASUK.includes(k)) ? "masuk" : "keluar";
    const existing = getCategoryByName(nama);
    if (existing) {
      const merged = [...new Set([...existing.keywords, ...keywords])];
      updateCategoryKeywords(existing.id, merged);
      if (tipe) setCategoryTipe(existing.id, tipe);
      return {
        text: `Kategori ${existing.nama} (${tipe}) diperbarui. Kata kunci: ${merged.join(", ")}`,
      };
    }
    addCategory(nama, keywords, tipe);
    return { text: `Kategori ${nama} [${tipe}] ditambah. Kata kunci: ${keywords.join(", ")}` };
  }

  if ((m = text.match(/^kategori sisi\s+(.+)$/i))) {
    const parts = m[1].trim().split(/\s+/);
    const tipe = parts[parts.length - 1].toLowerCase();
    const nama = parts.slice(0, -1).join(" ").trim();
    if (!["masuk", "keluar", "keduanya"].includes(tipe) || !nama) {
      return { text: "Format: `kategori sisi Sedekah keduanya` (masuk|keluar|keduanya)" };
    }
    const cat = getCategoryByName(nama);
    if (!cat) return { text: `Kategori "${nama}" tidak ada.` };
    setCategoryTipe(cat.id, tipe);
    return { text: `Kategori ${cat.nama} → ${tipe}.` };
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
    const g = crypto.randomUUID();
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
    const { account, per: perParsed, query } = parseFilter(arg);
    if (arg && !perParsed && query) {
      return {
        text: "Periode tidak dikenali. Contoh: `laporan september`, `laporan gopay september`, `laporan minggu lalu`.",
      };
    }
    const per = perParsed ?? parsePeriod("");
    if (!per) return { text: "Periode tidak dikenali." };
    const rows = ringkasRange(per.from, per.to, account?.id);
    const label = per.label + (account ? ` · ${account.nama}` : "");
    if (rows.length === 0) return { text: `Belum ada transaksi ${label}.` };
    const masuk = rows.filter((r) => r.tipe === "masuk");
    const keluar = rows.filter((r) => r.tipe === "keluar");
    const fmt = (rs: typeof rows) => rs.map((r) => `  ${r.kategori}: ${rupiah(r.total)}`).join("\n");
    const tMasuk = masuk.reduce((a, b) => a + b.total, 0);
    const tKeluar = keluar.reduce((a, b) => a + b.total, 0);
    const tr = transferRange(per.from, per.to, account?.id);
    const trLine =
      tr.masuk > 0 || tr.keluar > 0
        ? `\n\nTransfer: keluar ${rupiah(tr.keluar)} · masuk ${rupiah(tr.masuk)}`
        : "";
    return {
      text:
        `Ringkasan ${label}\n\nMasuk (${rupiah(tMasuk)})\n${fmt(masuk) || "  -"}\n\n` +
        `Keluar (${rupiah(tKeluar)})\n${fmt(keluar) || "  -"}\n\nSelisih: ${rupiahSigned(tMasuk - tKeluar)}` +
        trLine,
    };
  }

  if (/^cari\b/.test(low)) {
    const arg = text.replace(/^\s*cari\s*/i, "").trim();
    const { account, per, query } = parseFilter(arg);
    let q = query;
    let limit = 20;
    const numMatch = q.match(/\s+(\d{1,4})$/);
    if (numMatch) {
      limit = Math.min(10000, Number(numMatch[1]));
      q = q.slice(0, numMatch.index).trim();
    }
    const rows = searchTx(q, { accountId: account?.id, from: per?.from, to: per?.to, limit });
    if (rows.length === 0) return { text: "Tidak ada hasil." };
    const label = [q && `"${q}"`, account?.nama, per?.label].filter(Boolean).join(" · ");
    return {
      text:
        `Hasil ${rows.length}${label ? ` — ${label}` : ""}:\n` + rows.map(txLine).join("\n"),
    };
  }

  if ((m = low.match(/^lihat\s+#?(\d+)$/))) {
    const tx = getTx(Number(m[1]));
    if (!tx) return { text: `Id ${m[1]} tidak ada.` };
    return {
      text:
        `#${tx.id}\nTanggal: ${tx.tanggal}\nTipe: ${tx.tipe}\n` +
        `Jumlah: ${rupiahSigned(tx.jumlah)}\nKategori: ${tx.kategori}\nAkun: ${tx.akun ?? "-"}\n` +
        `Catatan: ${tx.catatan ?? "-"}` +
        (tx.transfer_id ? `\nTransfer pasangan: ya` : ""),
    };
  }

  if (/^hapus\b/.test(low)) {
    const arg = text.replace(/^\s*hapus\s*/i, "").trim();
    const ids = arg
      .split(/[\s,]+/)
      .map((s) => s.replace(/^#/, ""))
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
    if (ids.length === 0) return { text: "Format: `hapus 25` atau `hapus 24 25`." };
    const okIds: number[] = [];
    const failIds: number[] = [];
    let pairs = 0;
    for (const id of ids) {
      const n = deleteTx(id);
      if (n > 0) {
        okIds.push(id);
        if (n > 1) pairs += 1;
      } else {
        failIds.push(id);
      }
    }
    const parts: string[] = [];
    if (okIds.length) parts.push(`Terhapus: ${okIds.map((i) => `#${i}`).join(", ")}`);
    if (failIds.length) parts.push(`Tidak ada: ${failIds.map((i) => `#${i}`).join(", ")}`);
    if (pairs) parts.push(`(${pairs} transfer ikut terhapus pasangannya)`);
    return { text: parts.join("\n") };
  }

  if ((m = low.match(/^ubah\s+#?(\d+)\s+akun\s+(.+)$/))) {
    const id = Number(m[1]);
    const acc = getAccountByName(m[2]);
    if (!acc) return { text: `Akun "${m[2]}" tidak ada. Lihat: \`akun\`` };
    const tx = updateTx(id, { account_id: acc.id });
    return tx
      ? { text: `#${id} dipindah ke ${acc.nama}.`, txs: [withRupiah(tx)] }
      : { text: `Id ${id} tidak ada.` };
  }

  if ((m = low.match(/^ubah\s+#?(\d+)\s+jadi\s+(.+)$/))) {
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

  if ((m = low.match(/^(riwayat|history|list)(?:\s+(\d{1,3}))?$/))) {
    const n = Math.min(100, m[2] ? Number(m[2]) : 10);
    const rows = listTx(n);
    if (rows.length === 0) return { text: "Belum ada transaksi." };
    return {
      text:
        `${n} transaksi terakhir:\n` +
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
    const { account, per, query } = parseFilter(arg);
    if (query || (arg && !per && !account)) {
      return {
        text: "Filter tidak dikenali. Contoh: `csv september`, `csv gopay`, `csv gopay september`.",
      };
    }
    const rows =
      per || account
        ? searchTx("", { accountId: account?.id, from: per?.from, to: per?.to, limit: 10000 }).reverse()
        : listAll();
    if (rows.length === 0) {
      const label = [per?.label, account?.nama].filter(Boolean).join(" · ");
      return { text: `Tidak ada transaksi${label ? ` ${label}` : ""}.` };
    }
    const label = [per?.label ?? "semua", account?.nama].filter(Boolean).join(" · ");
    const name = `transaksi-${per ? `${per.from}_${per.to}` : "semua"}${account ? `-${account.nama}` : ""}.csv`;
    return {
      text: `CSV ${rows.length} transaksi (${label}).`,
      file: { name, content: toCSV(rows) },
    };
  }

  if (/^(grafik|chart|dashboard)\b/.test(low)) {
    const arg = text.replace(/^\s*(grafik|chart|dashboard)\s*/i, "").trim();
    const { account, per: perParsed, query } = parseFilter(arg);
    if (query) {
      return { text: "Periode/akun tidak dikenali. Contoh: `grafik`, `grafik september`, `grafik gopay september`." };
    }
    const per = perParsed ?? parsePeriod("");
    if (!per) return { text: "Periode tidak dikenali." };
    const rows = ringkasRange(per.from, per.to, account?.id);
    const label = per.label + (account ? ` · ${account.nama}` : " · semua akun");
    if (rows.length === 0) return { text: `Belum ada transaksi ${label}.` };

    const keluarCats = rows.filter((r) => r.tipe === "keluar").map((r) => ({ kategori: r.kategori, total: r.total }));
    const masukCats = rows.filter((r) => r.tipe === "masuk").map((r) => ({ kategori: r.kategori, total: r.total }));
    const masuk = masukCats.reduce((a, c) => a + c.total, 0);
    const keluar = keluarCats.reduce((a, c) => a + c.total, 0);

    const series = dailySeries(per.from, per.to, account?.id);
    const map = new Map(series.map((s) => [s.tanggal, s.keluar]));
    const daily = buildDailyRange(per.from, per.to).map((t) => ({ tanggal: t, keluar: map.get(t) ?? 0 }));

    const saldoLines = account
      ? undefined
      : accountBalances()
          .filter((a) => (a.saldo ?? 0) !== 0)
          .map((a) => `${a.nama} ${shortRp(a.saldo ?? 0)}`);

    const transfer = transferRange(per.from, per.to, account?.id);

    return {
      text: buildGrafik({ label, masuk, keluar, keluarCats, masukCats, daily, transfer, saldoLines }),
      pre: true,
    };
  }

  if (/^anggaran\b/.test(low)) {
    const arg = text.replace(/^\s*anggaran\s*/i, "").trim();
    if (!arg || arg.toLowerCase() === "list") {
      const bs = listBudgets();
      if (!bs.length) return { text: "Belum ada anggaran. Contoh: `anggaran Makanan 2jt`" };
      const per = parsePeriod("");
      const rows = per ? ringkasRange(per.from, per.to) : [];
      const spend = (k: string) =>
        rows
          .filter((r) => r.tipe === "keluar" && r.kategori.toLowerCase() === k.toLowerCase())
          .reduce((a, b) => a + b.total, 0);
      const lines = bs.map((b) => {
        const s = spend(b.kategori);
        const pct = b.jumlah > 0 ? Math.round((s / b.jumlah) * 100) : 0;
        const sisa = b.jumlah - s;
        const tail = sisa < 0 ? `tembus ${rupiah(-sisa)}` : `sisa ${rupiah(sisa)}`;
        return `  ${b.kategori}: ${rupiah(s)} / ${rupiah(b.jumlah)} (${pct}%) ${tail}`;
      });
      return { text: `Anggaran bulan ini:\n${lines.join("\n")}` };
    }
    let bm: RegExpMatchArray | null;
    if ((bm = arg.match(/^hapus\s+(.+)$/i))) {
      const ok = deleteBudget(bm[1]);
      return { text: ok ? `Anggaran ${bm[1]} dihapus.` : `Anggaran "${bm[1]}" tidak ada.` };
    }
    if ((bm = arg.match(/^(.+?)\s+([\d][\d.,]*(?:\s*(?:jt|juta|rb|ribu|k))?)$/i))) {
      const nama = bm[1].trim();
      const jumlah = parseAmount(bm[2]);
      if (jumlah == null || jumlah <= 0) {
        return { text: "Nominal anggaran tidak kebaca. Contoh: `anggaran Makanan 2jt`" };
      }
      setBudget(nama, jumlah);
      return { text: `Anggaran ${nama} = ${rupiah(jumlah)}/bulan.` };
    }
    return { text: "Format: `anggaran Makanan 2jt`, `anggaran hapus Makanan`, `anggaran`." };
  }

  const CMD_WORDS = [
    "hapus", "ubah", "lihat", "cari", "laporan", "ringkasan", "report", "csv", "export",
    "grafik", "chart", "dashboard", "anggaran",
    "riwayat", "history", "list", "akun", "kategori", "saldo", "transfer", "reset", "ai",
    "versi", "version", "help", "bantuan",
  ];
  const word = low.split(/\s+/)[0];
  if (CMD_WORDS.includes(word)) {
    return { text: `Perintah "${word}" tidak dikenali. Ketik \`help\` untuk daftar perintah.` };
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
  const warns = txs.map(budgetWarn).filter((w): w is string => !!w);
  const body = [usedAI ? `${head}\n(diproses AI)` : head, ...warns].join("\n");
  return { text: body, txs: txs.map(withRupiah) };
}

async function resolveTransactions(
  text: string
): Promise<{ results: ParseResult[]; usedAI: boolean }> {
  const local = parseLocal(text);

  if (local && local.confidence === "high") {
    return { results: [local.result], usedAI: false };
  }

  const ai = await parseGemini(text);
  if (ai && ai.length > 0) {
    if (local?.result.tanggal) {
      for (const a of ai) if (!a.tanggal) a.tanggal = local.result.tanggal;
    }
    return { results: ai, usedAI: true };
  }

  if (local) return { results: [local.result], usedAI: false };
  return { results: [], usedAI: false };
}

export { aiEnabled };
