// randomUUID dari crypto global (tersedia di browser & worker).
import {
  accountBalances,
  addAccount,
  addCategory,
  addDebt,
  addRecurring,
  addTx,
  debtTotals,
  deleteAccount,
  deleteAllTx,
  deleteBudget,
  deleteCategory,
  deleteDebt,
  deleteRecurring,
  deleteTx,
  dailySeries,
  getAccountByName,
  getBudget,
  getCategoryByName,
  getSetting,
  getTx,
  listAccounts,
  listAll,
  listBudgets,
  listCategories,
  listDebts,
  listRange,
  listRecurring,
  listTx,
  payDebt,
  ringkasRange,
  reconcileAccount,
  renameAccount,
  renameCategory,
  rupiah,
  rupiahSigned,
  runRecurring,
  saldo,
  searchTx,
  setAccountSaldoAwal,
  setBudget,
  setCategoryTipe,
  setSetting,
  transferRange,
  updateCategoryKeywords,
  updateTx,
  type Account,
  type Budget,
  type Debt,
  type Tx,
} from "./db";
import { parseLocal, MASUK, type ParseResult } from "./parser";
import { isoLocal, lastMonths, parsePeriod, previousPeriod, type Period } from "./dates";
import { toCSV } from "./csv";
import { buildDailyRange, buildDonutSvg, buildGrafik, buildTrendSvg, shortRp } from "./chart";
import { exportJson, importJson } from "./backup";
import { encryptJson, hashPin, safeEqual } from "./crypto";
import { aiEnabled, aiResetUsage, aiStats, parseGemini } from "./ai";
import { APP_VERSION } from "./version";

export interface Reply {
  text: string;
  txs?: Tx[];
  file?: { name: string; content: string };
  pre?: boolean;
  lock?: boolean;
  svg?: string;
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
  "  akun ubah seabank jadi bankjago\n" +
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
  "  laporan banding [bulan]      (vs periode sebelumnya)\n" +
  "  laporan arus kas 6           (6 bulan terakhir)\n" +
  "  laporan top 10 [bulan]       (pengeluaran terbesar)\n" +
  "  laporan akun bsi [bulan]\n" +
  "  grafik | grafik september | grafik gopay\n" +
  "  grafik komposisi [bulan] | grafik tren 6\n" +
  "  csv | csv september | csv gopay\n\n" +
  "Anggaran:\n" +
  "  anggaran | anggaran Makanan 2jt | anggaran Makanan 500rb mingguan\n" +
  "  anggaran rollover Makanan | anggaran no-rollover Makanan\n" +
  "  anggaran hapus Makanan\n\n" +
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
  "  undo                        (batalkan aksi terakhir)\n" +
  "  berulang listrik 350rb tiap 5   (auto tiap bulan)\n" +
  "  berulang | berulang hapus 1\n" +
  "  utang 100rb ke budi         (ledger utang/piutang)\n" +
  "  piutang 50rb dari andi\n" +
  "  bayar utang budi 50rb | utang hapus 3\n" +
  "  pin | pin atur 1234 | pin ubah 1234 5678\n" +
  "  pin hapus 1234              (matikan kunci)\n" +
  "  backup | backup kunci <sandi>   (JSON / terenkripsi)\n" +
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

function budgetWindow(b: Budget): Period | null {
  return b.periode === "mingguan" ? parsePeriod("minggu ini") : parsePeriod("");
}

function spentIn(kategori: string, per: Period): number {
  const k = kategori.toLowerCase();
  return ringkasRange(per.from, per.to)
    .filter((r) => r.tipe === "keluar" && r.kategori.toLowerCase() === k)
    .reduce((a, b) => a + b.total, 0);
}

// Carry = sisa periode lalu (bisa negatif). Hanya dipakai bila rollover aktif.
function budgetCarry(b: Budget): number {
  if (!b.rollover) return 0;
  const cur = budgetWindow(b);
  if (!cur) return 0;
  return b.jumlah - spentIn(b.kategori, previousPeriod(cur));
}

function budgetEffective(b: Budget): number {
  return Math.max(0, b.jumlah + budgetCarry(b));
}

function budgetWarn(t: Tx): string | null {
  if (t.tipe !== "keluar") return null;
  const b = getBudget(t.kategori);
  if (!b) return null;
  const limit = budgetEffective(b);
  if (limit <= 0) return null;
  const cur = budgetWindow(b);
  if (!cur) return null;
  const spent = spentIn(b.kategori, cur);
  const prev = spent - t.jumlah;
  const per = b.periode === "mingguan" ? "minggu ini" : "bulan ini";
  const carry = budgetCarry(b);
  const carryNote = carry !== 0 ? ` (limit ${rupiah(limit)}, carry ${carry > 0 ? "+" : "-"}${rupiah(Math.abs(carry))})` : "";
  if (prev < limit && spent >= limit) {
    return `⚠️ Anggaran ${t.kategori} tembus ${per}: ${rupiah(spent)} / ${rupiah(limit)}${carryNote}`;
  }
  if (prev < limit * 0.8 && spent >= limit * 0.8) {
    return `⚠️ Anggaran ${t.kategori} ${Math.floor((spent / limit) * 100)}% ${per}: ${rupiah(spent)} / ${rupiah(limit)}${carryNote}`;
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

// Undo berbasis snapshot penuh: sebelum tiap perintah, simpan hasil exportAll;
// kalau data berubah, snapshot lama masuk stack. Sederhana, tahan terhadap
// semua jenis mutasi (tambah/ubah/hapus/transfer/anggaran/akun).
const UNDO_LIMIT = 20;
const undoStack: string[] = [];

export async function handleMessage(input: string): Promise<Reply> {
  const text = input.trim();

  if (/^(undo|batalkan|batal)$/i.test(text)) {
    const snap = undoStack.pop();
    if (!snap) return { text: "Tidak ada perubahan untuk dibatalkan." };
    importJson(snap);
    return {
      text: `Dibatalkan. Data kembali ke kondisi sebelum perintah terakhir.${undoStack.length ? ` (bisa undo ${undoStack.length}× lagi)` : ""}`,
    };
  }

  const before = exportJson();
  const r = await handleMessageInner(text);
  if (exportJson() !== before) {
    undoStack.push(before);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  return r;
}

async function handleMessageInner(input: string): Promise<Reply> {
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

  let m: RegExpMatchArray | null;

  if (low === "pin" || low === "pin info") {
    const set = !!getSetting("pin_hash");
    return {
      text: set
        ? "PIN: aktif.\nApp mengunci otomatis setelah 2 menit idle atau saat pindah app.\nUbah: `pin ubah <lama> <baru>` · Matikan: `pin hapus <pin>`"
        : "PIN: nonaktif.\nPasang: `pin atur 1234` (4-8 digit).\nPIN hanya mengunci tampilan — data tetap tersimpan di perangkat.",
    };
  }

  if ((m = text.match(/^pin atur\s+(\S+)$/i))) {
    const pin = m[1].trim();
    if (!/^\d{4,8}$/.test(pin)) return { text: "PIN harus 4-8 digit angka. Contoh: `pin atur 1234`" };
    const h = await hashPin(pin);
    setSetting("pin_hash", h.hash);
    setSetting("pin_salt", h.salt);
    setSetting("pin_iter", String(h.iter));
    return {
      text: "PIN dipasang. App akan terkunci sekarang; masukkan PIN untuk membuka.\nLupa PIN = data tak bisa dibuka, tapi backup JSON tetap bisa di-restore di perangkat lain.",
      lock: true,
    };
  }

  if ((m = text.match(/^pin ubah\s+(\S+)\s+(\S+)$/i))) {
    const lama = m[1].trim();
    const baru = m[2].trim();
    if (!/^\d{4,8}$/.test(baru)) return { text: "PIN baru harus 4-8 digit angka." };
    const h = getSetting("pin_hash");
    if (!h) return { text: "Belum ada PIN. Pasang dengan `pin atur 1234`." };
    const c = await hashPin(lama, getSetting("pin_salt") ?? undefined, Number(getSetting("pin_iter") ?? 120000));
    if (!safeEqual(c.hash, h)) return { text: "PIN lama salah." };
    const n = await hashPin(baru);
    setSetting("pin_hash", n.hash);
    setSetting("pin_salt", n.salt);
    setSetting("pin_iter", String(n.iter));
    return { text: "PIN diganti.", lock: true };
  }

  if ((m = text.match(/^pin hapus\s+(\S+)$/i))) {
    const pin = m[1].trim();
    const h = getSetting("pin_hash");
    if (!h) return { text: "Belum ada PIN." };
    const c = await hashPin(pin, getSetting("pin_salt") ?? undefined, Number(getSetting("pin_iter") ?? 120000));
    if (!safeEqual(c.hash, h)) return { text: "PIN salah. PIN tidak dihapus." };
    setSetting("pin_hash", null);
    setSetting("pin_salt", null);
    setSetting("pin_iter", null);
    return { text: "PIN dihapus. App tak lagi terkunci." };
  }

  if ((m = text.match(/^backup(?:\s+kunci\s+(.+))?$/i))) {
    const pass = (m[1] ?? "").trim();
    const stamp = new Date().toISOString().slice(0, 10);
    const plain = exportJson();
    if (!pass) {
      setSetting("last_backup_at", isoLocal());
      return {
        text:
          "Backup JSON biasa siap diunduh.\n" +
          "Ingin terenkripsi? `backup kunci <kata sandi>` (minimal 8 karakter).",
        file: { name: `stacker-backup-${stamp}.json`, content: plain },
      };
    }
    if (pass.length < 8) {
      return { text: "Kata sandi minimal 8 karakter. Contoh: `backup kunci rahasia-panjang-2026`" };
    }
    const enc = await encryptJson(plain, pass);
    setSetting("last_backup_at", isoLocal());
    return {
      text:
        "Backup terenkripsi siap diunduh (AES-GCM 256, PBKDF2).\n" +
        "Simpan kata sandinya — tanpa itu file tak bisa dibuka.",
      file: { name: `stacker-backup-${stamp}.enc.json`, content: enc },
    };
  }

  if (/^reset\s+(transaksi|laporan|semua)$/i.test(text)) {
    const bkp = exportJson();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `backup-pre-reset-${stamp}.json`;
    const n = deleteAllTx();
    return {
      text:
        `Semua transaksi dihapus (${n}). Saldo kini = saldo awal tiap akun.\n` +
        `Backup sebelum reset: ${name} (file terunduh otomatis).`,
      file: { name, content: bkp },
    };
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

  if ((m = text.match(/^akun ubah\s+(.+?)\s+(?:jadi|menjadi)\s+(.+)$/i))) {
    const lama = m[1].trim();
    const baru = m[2].trim();
    const acc = getAccountByName(lama);
    if (!acc) return { text: `Akun "${lama}" tidak ada.` };
    if (getAccountByName(baru)) return { text: `Akun "${baru}" sudah ada.` };
    renameAccount(acc.id, baru);
    return { text: `Akun ${lama} → ${baru}.` };
  }

  if ((m = text.match(/^akun hapus\s+(.+)$/i))) {
    const acc = getAccountByName(m[1]);
    if (!acc) return { text: `Akun "${m[1]}" tidak ada.` };
    const res = deleteAccount(acc.id);
    const movedTxt =
      res.moved > 0 && res.to
        ? ` ${res.moved} transaksi dipindah ke akun ${res.to}.`
        : " Tidak ada transaksi terkait.";
    return { text: `Akun ${acc.nama} dihapus.${movedTxt}` };
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

  if ((m = text.match(/^kategori ubah\s+(.+?)\s+jadi\s+(.+)$/i))) {
    const lama = m[1].trim();
    const baru = m[2].trim();
    const cat = getCategoryByName(lama);
    if (!cat) return { text: `Kategori "${lama}" tidak ada.` };
    if (getCategoryByName(baru)) return { text: `Kategori "${baru}" sudah ada.` };
    renameCategory(cat.id, baru);
    return { text: `Kategori ${lama} → ${baru}. Riwayat transaksi & anggaran ikut diganti.` };
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

    if (/^banding\b/i.test(arg)) {
      const rest = arg.replace(/^banding\s*/i, "").trim();
      const { account, per: perParsed, query } = parseFilter(rest);
      if (query) return { text: "Periode tidak dikenali. Contoh: `laporan banding september`." };
      const per = perParsed ?? parsePeriod("");
      if (!per) return { text: "Periode tidak dikenali." };
      const prev = previousPeriod(per);
      const totals = (p: Period) => {
        const rows = ringkasRange(p.from, p.to, account?.id);
        const masuk = rows.filter((r) => r.tipe === "masuk").reduce((a, b) => a + b.total, 0);
        const keluar = rows.filter((r) => r.tipe === "keluar").reduce((a, b) => a + b.total, 0);
        return { masuk, keluar, rows };
      };
      const now = totals(per);
      const before = totals(prev);
      if (now.rows.length === 0 && before.rows.length === 0) {
        return { text: `Belum ada transaksi ${per.label}.` };
      }
      const pct = (a: number, b: number) =>
        b === 0 ? (a === 0 ? "0%" : "baru") : `${a >= b ? "+" : ""}${Math.round(((a - b) / Math.abs(b)) * 100)}%`;
      const catMap = new Map<string, { now: number; before: number }>();
      for (const r of now.rows.filter((r) => r.tipe === "keluar")) {
        const e = catMap.get(r.kategori) ?? { now: 0, before: 0 };
        e.now += r.total;
        catMap.set(r.kategori, e);
      }
      for (const r of before.rows.filter((r) => r.tipe === "keluar")) {
        const e = catMap.get(r.kategori) ?? { now: 0, before: 0 };
        e.before += r.total;
        catMap.set(r.kategori, e);
      }
      const movers = [...catMap.entries()]
        .map(([k, v]) => ({ k, d: v.now - v.before, now: v.now, before: v.before }))
        .filter((x) => x.d !== 0)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
        .slice(0, 5)
        .map((x) => `  ${x.k}: ${x.d > 0 ? "+" : "-"}${rupiah(Math.abs(x.d))} (${shortRp(x.before)} → ${shortRp(x.now)})`);
      const acc = account ? ` · ${account.nama}` : "";
      return {
        text:
          `Banding ${per.label}${acc}\n` +
          `vs ${prev.from} s/d ${prev.to}\n\n` +
          `Masuk   ${rupiah(now.masuk)} vs ${rupiah(before.masuk)} (${pct(now.masuk, before.masuk)})\n` +
          `Keluar  ${rupiah(now.keluar)} vs ${rupiah(before.keluar)} (${pct(now.keluar, before.keluar)})\n` +
          `Selisih ${rupiahSigned(now.masuk - now.keluar)} vs ${rupiahSigned(before.masuk - before.keluar)} ` +
          `(${rupiahSigned((now.masuk - now.keluar) - (before.masuk - before.keluar))})` +
          (movers.length ? `\n\nPerubahan per kategori:\n${movers.join("\n")}` : ""),
      };
    }

    if (/^arus\s*kas\b/i.test(arg)) {
      const rest = arg.replace(/^arus\s*kas\s*/i, "").trim();
      const nm = rest.match(/\b(\d{1,2})\b/);
      if (rest && !nm) return { text: "Format: `laporan arus kas 6` (jumlah bulan 2–24)." };
      const n = Math.min(24, Math.max(2, nm ? Number(nm[1]) : 6));
      const rows = lastMonths(n).map((p) => {
        const r = ringkasRange(p.from, p.to);
        const masuk = r.filter((x) => x.tipe === "masuk").reduce((a, b) => a + b.total, 0);
        const keluar = r.filter((x) => x.tipe === "keluar").reduce((a, b) => a + b.total, 0);
        return { per: p, masuk, keluar, net: masuk - keluar };
      });
      const tMasuk = rows.reduce((a, r) => a + r.masuk, 0);
      const tKeluar = rows.reduce((a, r) => a + r.keluar, 0);
      const w = Math.max(...rows.map((r) => r.per.label.length), 7);
      const lines = rows.map(
        (r) =>
          `  ${r.per.label.padEnd(w)}  +${shortRp(r.masuk).padStart(6)}  -${shortRp(r.keluar).padStart(6)}  ` +
          `${r.net < 0 ? "-" : "+"}${shortRp(r.net)}`
      );
      return {
        text:
          `Arus kas ${n} bulan terakhir (tanpa transfer)\n\n${lines.join("\n")}\n\n` +
          `Total masuk ${rupiah(tMasuk)} · keluar ${rupiah(tKeluar)} · net ${rupiahSigned(tMasuk - tKeluar)}`,
        svg: buildTrendSvg(
          rows.map((r) => ({ label: r.per.label.slice(0, 3), masuk: r.masuk, keluar: r.keluar }))
        ),
        pre: true,
      };
    }

    if (/^top\b/i.test(arg)) {
      let rest = arg.replace(/^top\s*/i, "").trim();
      let n = 10;
      const nm = rest.match(/^(\d{1,3})\b\s*/);
      if (nm) {
        n = Math.min(100, Math.max(1, Number(nm[1])));
        rest = rest.slice(nm[0].length);
      }
      const { account, per: perParsed, query } = parseFilter(rest);
      if (query) return { text: "Periode tidak dikenali. Contoh: `laporan top 10 september`." };
      const per = perParsed ?? parsePeriod("");
      if (!per) return { text: "Periode tidak dikenali." };
      const rows = listRange(per.from, per.to)
        .filter((t) => t.tipe === "keluar" && !t.transfer_id && (!account || t.account_id === account.id))
        .sort((a, b) => b.jumlah - a.jumlah)
        .slice(0, n);
      if (rows.length === 0) return { text: `Belum ada pengeluaran ${per.label}.` };
      const lines = rows.map((t, i) => {
        const note = t.catatan ? ` · ${t.catatan}` : "";
        return `  ${String(i + 1).padStart(2)}. ${t.tanggal.slice(5)} ${t.kategori}${note} — ${rupiah(t.jumlah)}`;
      });
      const total = rows.reduce((a, t) => a + t.jumlah, 0);
      return {
        text:
          `Top ${rows.length} pengeluaran ${per.label}${account ? ` · ${account.nama}` : ""}\n\n` +
          `${lines.join("\n")}\n\nTotal ${rupiah(total)}`,
      };
    }

    if (/^akun\b/i.test(arg)) {
      const rest = arg.replace(/^akun\s*/i, "").trim();
      const { account, per: perParsed, query } = parseFilter(rest);
      if (query) return { text: "Periode tidak dikenali. Contoh: `laporan akun bsi september`." };
      if (!account) return { text: "Sebut akunnya. Contoh: `laporan akun bsi september`." };
      const per = perParsed ?? parsePeriod("");
      if (!per) return { text: "Periode tidak dikenali." };
      const rows = ringkasRange(per.from, per.to, account.id);
      const tr = transferRange(per.from, per.to, account.id);
      if (rows.length === 0 && tr.masuk === 0 && tr.keluar === 0) {
        return { text: `Belum ada transaksi ${account.nama} ${per.label}.` };
      }
      const masuk = rows.filter((r) => r.tipe === "masuk");
      const keluar = rows.filter((r) => r.tipe === "keluar");
      const tMasuk = masuk.reduce((a, b) => a + b.total, 0);
      const tKeluar = keluar.reduce((a, b) => a + b.total, 0);
      const fmt = (rs: typeof rows) => rs.map((r) => `  ${r.kategori}: ${rupiah(r.total)}`).join("\n");
      const saldoNow = accountBalances().find((a) => a.id === account.id)?.saldo ?? 0;
      return {
        text:
          `Akun ${account.nama} · ${per.label}\n\nMasuk (${rupiah(tMasuk)})\n${fmt(masuk) || "  -"}\n\n` +
          `Keluar (${rupiah(tKeluar)})\n${fmt(keluar) || "  -"}\n\n` +
          `Arus bersih: ${rupiahSigned(tMasuk - tKeluar)}` +
          (tr.masuk || tr.keluar
            ? `\nTransfer: masuk ${rupiah(tr.masuk)} · keluar ${rupiah(tr.keluar)}`
            : "") +
          `\nSaldo sekarang: ${rupiahSigned(saldoNow)}`,
      };
    }

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

    if (/^komposisi\b/i.test(arg)) {
      const rest = arg.replace(/^komposisi\s*/i, "").trim();
      const { account, per: perParsed, query } = parseFilter(rest);
      if (query) return { text: "Periode tidak dikenali. Contoh: `grafik komposisi september`." };
      const per = perParsed ?? parsePeriod("");
      if (!per) return { text: "Periode tidak dikenali." };
      const rows = ringkasRange(per.from, per.to, account?.id);
      const cats = rows
        .filter((r) => r.tipe === "keluar")
        .map((r) => ({ kategori: r.kategori, total: r.total }))
        .sort((a, b) => b.total - a.total);
      const total = cats.reduce((a, c) => a + c.total, 0);
      const label = per.label + (account ? ` · ${account.nama}` : "");
      if (cats.length === 0) return { text: `Belum ada pengeluaran ${label}.` };
      const maxCats = 6;
      const shown = cats.slice(0, maxCats);
      const restSum = cats.slice(maxCats).reduce((a, c) => a + c.total, 0);
      if (restSum > 0) shown.push({ kategori: "Lainnya", total: restSum });
      const legend = shown.map((c) => {
        const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
        return `  ${c.kategori}: ${rupiah(c.total)} (${pct}%)`;
      });
      return {
        text: `Komposisi pengeluaran ${label}\nTotal ${rupiah(total)}\n${legend.join("\n")}`,
        svg: buildDonutSvg(cats, { maxCats, centerLabel: "keluar" }),
      };
    }

    if (/^tren\b/i.test(arg)) {
      const rest = arg.replace(/^tren\s*/i, "").trim();
      const nm = rest.match(/\b(\d{1,2})\b/);
      if (rest && !nm) return { text: "Format: `grafik tren 6` (jumlah bulan 2–24)." };
      const n = Math.min(24, Math.max(2, nm ? Number(nm[1]) : 6));
      const rows = lastMonths(n).map((p) => {
        const r = ringkasRange(p.from, p.to);
        return {
          per: p,
          masuk: r.filter((x) => x.tipe === "masuk").reduce((a, b) => a + b.total, 0),
          keluar: r.filter((x) => x.tipe === "keluar").reduce((a, b) => a + b.total, 0),
        };
      });
      const totalMasuk = rows.reduce((a, r) => a + r.masuk, 0);
      const totalKeluar = rows.reduce((a, r) => a + r.keluar, 0);
      const lines = rows.map(
        (r) =>
          `  ${r.per.label.padEnd(14)} masuk ${shortRp(r.masuk)} · keluar ${shortRp(r.keluar)} · ` +
          `${r.masuk - r.keluar < 0 ? "-" : "+"}${shortRp(r.masuk - r.keluar)}`
      );
      return {
        text:
          `Tren ${n} bulan terakhir\n${lines.join("\n")}\n\n` +
          `Total masuk ${rupiah(totalMasuk)} · keluar ${rupiah(totalKeluar)} · ` +
          `net ${rupiahSigned(totalMasuk - totalKeluar)}`,
        svg: buildTrendSvg(
          rows.map((r) => ({ label: r.per.label.slice(0, 3), masuk: r.masuk, keluar: r.keluar }))
        ),
        pre: true,
      };
    }

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
      const lines = bs.map((b) => {
        const win = budgetWindow(b);
        const s = win ? spentIn(b.kategori, win) : 0;
        const limit = budgetEffective(b);
        const carry = budgetCarry(b);
        const pct = limit > 0 ? Math.round((s / limit) * 100) : 0;
        const sisa = limit - s;
        const tail = sisa < 0 ? `tembus ${rupiah(-sisa)}` : `sisa ${rupiah(sisa)}`;
        const carryNote =
          b.rollover && carry !== 0 ? ` carry ${carry > 0 ? "+" : "-"}${rupiah(Math.abs(carry))}` : "";
        const badge = `${b.periode}${b.rollover ? " ↻" : ""}`;
        return `  ${b.kategori} [${badge}]: ${rupiah(s)} / ${rupiah(limit)} (${pct}%) ${tail}${carryNote}`;
      });
      return { text: `Anggaran bulanan/mingguan:\n${lines.join("\n")}` };
    }
    let bm: RegExpMatchArray | null;
    if ((bm = arg.match(/^hapus\s+(.+)$/i))) {
      const ok = deleteBudget(bm[1]);
      return { text: ok ? `Anggaran ${bm[1]} dihapus.` : `Anggaran "${bm[1]}" tidak ada.` };
    }
    if ((bm = arg.match(/^(?:rollover)\s+(.+)$/i))) {
      const b = getBudget(bm[1]);
      if (!b) return { text: `Anggaran "${bm[1]}" belum ada. Set dulu: \`anggaran ${bm[1]} 2jt\`.` };
      setBudget(b.kategori, b.jumlah, { rollover: true });
      return { text: `Rollover ${b.kategori} aktif: sisa periode lalu menambah/mengurangi limit.` };
    }
    if ((bm = arg.match(/^(?:no-rollover|tanpa\s+rollover)\s+(.+)$/i))) {
      const b = getBudget(bm[1]);
      if (!b) return { text: `Anggaran "${bm[1]}" belum ada.` };
      setBudget(b.kategori, b.jumlah, { rollover: false });
      return { text: `Rollover ${b.kategori} dimatikan.` };
    }
    if ((bm = arg.match(/^(.+?)\s+([\d][\d.,]*(?:\s*(?:jt|juta|rb|ribu|k))?)(?:\s+(mingguan|bulanan))?$/i))) {
      const nama = bm[1].trim();
      const jumlah = parseAmount(bm[2]);
      const periode = (bm[3]?.toLowerCase() as "mingguan" | "bulanan" | undefined) ?? undefined;
      if (jumlah == null || jumlah <= 0) {
        return { text: "Nominal anggaran tidak kebaca. Contoh: `anggaran Makanan 2jt`" };
      }
      setBudget(nama, jumlah, { periode });
      const suffix = periode === "mingguan" ? "/minggu" : periode === "bulanan" ? "/bulan" : "";
      return { text: `Anggaran ${nama} = ${rupiah(jumlah)}${suffix || "/bulan"}.` };
    }
    return {
      text:
        "Format: `anggaran Makanan 2jt`, `anggaran Makanan 500rb mingguan`, " +
        "`anggaran rollover Makanan`, `anggaran no-rollover Makanan`, `anggaran hapus Makanan`, `anggaran`.",
    };
  }

  if (low === "berulang" || low === "berulang list" || low === "transaksi berulang") {
    const rows = listRecurring();
    if (rows.length === 0) {
      return { text: "Belum ada transaksi berulang. Contoh: `berulang listrik 350rb tiap 5`." };
    }
    const lines = rows.map((r) => {
      const acc = r.account_id != null ? ` · ${listAccounts().find((a) => a.id === r.account_id)?.nama ?? "?"}` : "";
      const status = r.aktif ? "aktif" : "nonaktif";
      return `  #${r.id} ${r.catatan} ${r.tipe === "masuk" ? "+" : "-"}${rupiah(r.jumlah)} tiap tgl ${r.hari}${acc} (${status})${r.terakhir ? ` · terakhir ${r.terakhir}` : ""}`;
    });
    return { text: `Transaksi berulang:\n${lines.join("\n")}` };
  }

  if ((m = text.match(/^berulang hapus\s+#?(\d+)$/i))) {
    const id = Number(m[1]);
    return { text: deleteRecurring(id) ? `Transaksi berulang #${id} dihapus.` : `Tidak ada #${id}.` };
  }

  if ((m = text.match(/^berulang\s+(.+)$/i))) {
    let rest = m[1].trim();
    let hari = 1;
    const tiap = rest.match(/\btiap\s+(?:tgl\s+|tanggal\s+)?(\d{1,2})\b/i);
    if (tiap && tiap.index != null) {
      hari = Number(tiap[1]);
      rest = (rest.slice(0, tiap.index) + rest.slice(tiap.index + tiap[0].length)).trim();
    }
    if (hari < 1 || hari > 28) return { text: "Tanggal harus 1-28 (biar aman di semua bulan)." };
    const { account, query } = parseFilter(rest);
    const parsed = parseLocal(query || rest);
    if (!parsed || parsed.result.jumlah <= 0) {
      return { text: "Format: `berulang listrik 350rb tiap 5` (opsional: `bsi listrik 350rb tiap 5`)." };
    }
    const rec = addRecurring({
      catatan: query || parsed.result.catatan,
      jumlah: parsed.result.jumlah,
      tipe: parsed.result.tipe,
      kategori: parsed.result.kategori,
      account_id: account?.id ?? null,
      hari,
    });
    const ran = runRecurring();
    const tail = ran.created > 0 ? `\nLangsung dicatat: ${ran.entries.join(", ")}` : "";
    return {
      text:
        `Berulang #${rec.id}: ${rec.catatan} ${rupiah(rec.jumlah)} tiap tgl ${hari}` +
        `${account ? ` · ${account.nama}` : ""} → ${rec.kategori}.${tail}`,
    };
  }

  if (low === "utang" || low === "piutang" || low === "utang piutang" || low === "hutang") {
    const rows = listDebts();
    const t = debtTotals();
    if (rows.length === 0) {
      return { text: "Belum ada utang/piutang.\nContoh: `utang 100rb ke budi`, `piutang 50rb dari andi`." };
    }
    const fmt = (d: Debt) =>
      `  #${d.id} ${d.nama}: ${rupiah(d.sisa)}${d.sisa !== d.jumlah ? ` (dari ${rupiah(d.jumlah)})` : ""} · ${d.tanggal}`;
    const u = rows.filter((d) => d.arah === "utang");
    const p = rows.filter((d) => d.arah === "piutang");
    return {
      text:
        `Utang saya: ${rupiah(t.utang)} · Piutang saya: ${rupiah(t.piutang)}\n\n` +
        `Utang (harus dibayar):\n${u.map(fmt).join("\n") || "  -"}\n\n` +
        `Piutang (harus diterima):\n${p.map(fmt).join("\n") || "  -"}\n\n` +
        "Bayar: `bayar utang budi 50rb` · `bayar piutang andi 50rb` · `utang hapus 3`",
    };
  }

  if ((m = text.match(/^utang hapus\s+#?(\d+)$/i))) {
    const id = Number(m[1]);
    return { text: deleteDebt(id) ? `Utang/piutang #${id} dihapus.` : `Tidak ada #${id}.` };
  }

  if ((m = text.match(/^bayar\s+(utang|piutang)\s+(.+?)\s+(\d[\d.,]*(?:\s*(?:jt|juta|rb|ribu|k))?)$/i))) {
    const arah = m[1].toLowerCase() === "utang" ? "utang" : "piutang";
    const nama = m[2].trim();
    const nominal = parseAmount(m[3]);
    if (nominal == null || nominal <= 0) return { text: "Nominal tidak kebaca. Contoh: `bayar utang budi 50rb`" };
    const res = payDebt(arah, nama, nominal);
    if (res.paid === 0) return { text: `Tidak ada ${arah} aktif untuk "${nama}".` };
    const tail = res.sisaTotal > 0 ? `Sisa ${rupiah(res.sisaTotal)}.` : "Lunas.";
    return {
      text: `${arah === "utang" ? "Utang" : "Piutang"} ${res.nama} dibayar ${rupiah(res.paid)}. ${tail}`,
    };
  }

  if ((m = text.match(/^(utang|piutang|hutang)\s+(.+)$/i))) {
    const arah: "utang" | "piutang" = m[1].toLowerCase() === "piutang" ? "piutang" : "utang";
    const rest = m[2].trim();
    const prep = arah === "utang" ? "ke" : "dari";
    let nama = "";
    let amountRaw = "";

    let km = rest.match(new RegExp(`^(.+?)\\s+${prep}\\s+(.+)$`, "i"));
    if (km) {
      amountRaw = km[1].trim();
      nama = km[2].trim();
    } else {
      km = rest.match(new RegExp(`^${prep}\\s+(.+?)\\s+([\\d][\\d.,]*(?:\\s*(?:jt|juta|rb|ribu|k))?)$`, "i"));
      if (km) {
        nama = km[1].trim();
        amountRaw = km[2].trim();
      }
    }

    if (!nama || !amountRaw) {
      return { text: `Format: \`${arah} 100rb ${prep} budi\` atau \`${arah} ${prep} budi 100rb\`.` };
    }
    const nominal = parseAmount(amountRaw);
    if (nominal == null || nominal <= 0) return { text: "Nominal tidak kebaca. Contoh: `utang 100rb ke budi`" };
    const d = addDebt({ arah, nama, jumlah: nominal });
    return {
      text:
        `${arah === "utang" ? "Utang" : "Piutang"} #${d.id}: ${rupiah(d.jumlah)} ${arah === "utang" ? "ke" : "dari"} ${d.nama} dicatat.` +
        "\n(ledger utang/piutang terpisah — tidak mengubah saldo akun)",
    };
  }

  const CMD_WORDS = [
    "hapus", "ubah", "lihat", "cari", "laporan", "ringkasan", "report", "csv", "export",
    "grafik", "chart", "dashboard", "anggaran",
    "riwayat", "history", "list", "akun", "kategori", "saldo", "transfer", "reset", "ai",
    "versi", "version", "help", "bantuan", "utang", "piutang", "hutang", "bayar", "pin", "backup",
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
