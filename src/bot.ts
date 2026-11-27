// randomUUID dari crypto global (tersedia di browser & worker).
import { COMMAND_WORD_SET } from "./commands";
import {
  accountBalances,
  activeDaysSince,
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
  deleteTxWithIds,
  dailySeries,
  getAccountByName,
  getBudget,
  getCategoryByName,
  getDebt,
  getGoalByName,
  addGoal,
  listGoals,
  contributeGoal,
  deleteGoal,
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
  resetAccounts,
  resetAll,
  resetCategories,
  recurringDue,
  rupiah,
  rupiahSigned,
  runRecurring,
  saldo,
  searchTx,
  setAccountSaldoAwal,
  setBudget,
  setCategoryTipe,
  setCategoryIcon,
  setSetting,
  totalChanges,
  transferRange,
  updateCategoryKeywords,
  updateRecurring,
  updateTransferAmount,
  updateTransferDate,
  updateTx,
  withTransaction,
  type Account,
  type Budget,
  type Debt,
  type Tx,
} from "./db";
import { parseLocal, parseLocalMulti, type ParseResult } from "./parser";
import {
  extractDate,
  isoLocal,
  lastMonths,
  parsePeriod,
  previousMonthPeriod,
  previousPeriod,
  type Period,
} from "./dates";
import { parseCSV, toCSV } from "./csv";
import {
  buildDailyRange,
  buildDonutSvg,
  buildGrafik,
  buildTrendSvg,
  shortRp,
  shortRpSigned,
} from "./chart";
import { exportJson, importJson } from "./backup";
import { encryptJson } from "./crypto";
import { aiEnabled, aiResetUsage, aiStats, parseGemini } from "./ai";
import { APP_VERSION } from "./version";
import { HELP } from "./bot/help";
import {
  budgetCarry,
  budgetEffective,
  budgetOverview,
  budgetWarn,
  budgetWindow,
  computeAlloc,
  computeHealth,
  dashboardData,
  spentIn,
  type Alloc,
  type BudgetRow,
  type Health,
  type HealthFactor,
} from "./bot/analytics";
export {
  budgetOverview,
  computeAlloc,
  computeHealth,
  dashboardData,
  type Alloc,
  type BudgetRow,
  type Health,
  type HealthFactor,
};

export interface Reply {
  text: string;
  txs?: Tx[];
  removedIds?: number[];
  file?: { name: string; content: string };
  pre?: boolean;
  lock?: boolean;
  svg?: string;
}

const TIPE_AKUN = ["bank", "ewallet", "cash"];

// ---------- Alias perintah ----------
const ALIAS_TARGETS = [
  "transfer", "hapus", "ubah", "laporan", "ringkasan", "grafik", "csv", "cari",
  "lihat", "riwayat", "saldo", "akun", "kategori", "anggaran", "berulang",
  "utang", "piutang", "bayar", "target", "tag", "pin", "backup", "ai", "versi", "help",
  "undo", "alias",
];
const ALIAS_TARGET_SET = new Set(ALIAS_TARGETS);
// Kata yang sudah dipakai perintah/sinonim/arah; tak boleh dijadikan alias.
const ALIAS_RESERVED = new Set([
  ...ALIAS_TARGETS,
  // reset sengaja tidak boleh jadi alias: perintah ini butuh konfirmasi UI.
  "reset",
  "redo", "ulangi",
  "history", "list", "daftar", "bantuan", "report", "chart", "dashboard", "export",
  "hutang", "batal", "batalkan", "info", "version", "sesuaikan", "betulkan",
  "masuk", "keluar", "pengeluaran", "pemasukan", "terima", "dapat",
]);

// Cek bentrok nama/kata kunci baru dengan alias yang sudah ada.
function aliasConflict(words: string[]): string | null {
  const map = loadAliases();
  for (const w of words) {
    const k = w.toLowerCase().trim();
    if (k && map[k]) return `"${k}" bentrok dengan alias → ${map[k]}`;
  }
  return null;
}

// Cek bentrok satu kata kunci: perintah, alias, atau kategori lain.
// exceptId: kategori yang sedang diedit (boleh punya kata kunci itu sendiri).
function keywordConflict(kw: string, exceptId?: number): string | null {
  const k = kw.toLowerCase().trim();
  if (!k) return null;
  if (COMMAND_WORD_SET.has(k)) return "bentrok perintah";
  const aliases = loadAliases();
  if (aliases[k]) return `bentrok alias → ${aliases[k]}`;
  for (const c of listCategories()) {
    if (exceptId != null && c.id === exceptId) continue;
    if (c.nama.toLowerCase() === k) return `bentrok nama kategori ${c.nama}`;
    if (c.keywords.some((x) => x.toLowerCase() === k)) return `sudah dipakai kategori ${c.nama}`;
  }
  return null;
}

// Pisahkan "<nama> <pemisah> <kata kunci>" dengan pemisah | : = (opsional).
function splitNameKw(rest: string): { name: string; kwRaw: string } {
  const i = rest.search(/[|:=]/);
  return i === -1
    ? { name: rest.trim(), kwRaw: "" }
    : { name: rest.slice(0, i).trim(), kwRaw: rest.slice(i + 1).trim() };
}

// Kata kunci dipisah koma dan/atau spasi.
function splitKw(raw: string): string[] {
  return raw.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function loadAliases(): Record<string, string> {
  try {
    const raw = getSetting("cmd_aliases");
    const parsed = JSON.parse(raw ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== "string") continue;
      const target = v.trim().toLowerCase().replace(/\s+/g, " ");
      const first = target.split(/\s+/)[0] ?? "";
      if (first !== "reset" && ALIAS_TARGET_SET.has(first)) out[k] = target;
    }
    return out;
  } catch {
    return {};
  }
}

function saveAliases(map: Record<string, string>): void {
  setSetting("cmd_aliases", Object.keys(map).length ? JSON.stringify(map) : null);
}

function expandAlias(text: string): string {
  const m = text.match(/^(\S+)([\s\S]*)$/);
  if (!m) return text;
  const target = loadAliases()[m[1].toLowerCase()];
  return target ? target + m[2] : text;
}

function aliasesText(): string {
  const map = loadAliases();
  const rows = Object.keys(map)
    .sort()
    .map((a) => `  ${a} → ${map[a]}`);
  const targets = ALIAS_TARGETS.join(", ");
  if (!rows.length) {
    return (
      "Belum ada alias.\nBuat: `alias tf transfer`\n" +
      `Target: ${targets}`
    );
  }
  return `Alias perintah:\n${rows.join("\n")}\n\nTarget: ${targets}`;
}

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

// Awalan nama akun (boleh berspasi) + sisa teks. Nama terpanjang menang.
function accountPrefix(text: string): { acc: Account; rest: string } | null {
  const low = text.toLowerCase();
  const accounts = [...listAccounts()].sort((a, b) => b.nama.length - a.nama.length);
  for (const acc of accounts) {
    const n = acc.nama.toLowerCase();
    if (low === n || low.startsWith(n + " ")) {
      return { acc, rest: text.slice(acc.nama.length).trim() };
    }
  }
  return null;
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
interface SnapshotEntry {
  snap: string;
  label: string;
  at: number;
}

const UNDO_LIMIT = 20;
const REDO_LIMIT = 20;
// Batas kasar memori per stack (panjang string; snapshot JSON ASCII).
const SNAPSHOT_BYTES_LIMIT = 4 * 1024 * 1024;
const undoStack: SnapshotEntry[] = [];
const redoStack: SnapshotEntry[] = [];

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function undoLabel(): string | null {
  return undoStack.length ? undoStack[undoStack.length - 1].label : null;
}

export function redoLabel(): string | null {
  return redoStack.length ? redoStack[redoStack.length - 1].label : null;
}

export function undoCount(): number {
  return undoStack.length;
}

export function redoCount(): number {
  return redoStack.length;
}

function stackBytes(stack: SnapshotEntry[]): number {
  let total = 0;
  for (const entry of stack) total += entry.snap.length;
  return total;
}

function trimStack(stack: SnapshotEntry[], limit: number): void {
  while (stack.length > limit) stack.shift();
  // Sisakan minimal satu snapshot walau satu entri melebihi budget.
  while (stack.length > 1 && stackBytes(stack) > SNAPSHOT_BYTES_LIMIT) stack.shift();
}

function pushUndo(snap: string, label: string): void {
  pushUndoKeepRedo(snap, label);
  redoStack.length = 0;
}

function pushUndoKeepRedo(snap: string, label: string): void {
  undoStack.push({ snap, label, at: Date.now() });
  trimStack(undoStack, UNDO_LIMIT);
}

function pushRedo(snap: string, label: string): void {
  redoStack.push({ snap, label, at: Date.now() });
  trimStack(redoStack, REDO_LIMIT);
}

// Cache snapshot agar perintah baca tidak perlu export berulang.
let cachedSnapshot: string | null = null;
let cachedSnapshotAt: number | null = null;

function currentState(): string {
  const changes = totalChanges();
  if (cachedSnapshot === null || cachedSnapshotAt !== changes) {
    cachedSnapshot = exportJson();
    cachedSnapshotAt = changes;
  }
  return cachedSnapshot;
}

function rememberSnapshot(snap: string): void {
  cachedSnapshot = snap;
  cachedSnapshotAt = totalChanges();
}

function actionLabel(text: string): string {
  const label = text.replace(/\s+/g, " ").trim();
  if (!label) return "perintah";
  return label.length > 48 ? `${label.slice(0, 47)}…` : label;
}

// Kembalikan snapshot untuk undo/redo, tetapi pertahankan metadata lokal
// (timestamp backup terakhir) agar pengingat backup tidak “kembali”.
function restoreSnapshot(snap: string): void {
  const localBackupAt = getSetting("last_backup_at");
  importJson(snap);
  setSetting("last_backup_at", localBackupAt);
  rememberSnapshot(exportJson());
}

// Dipakai tombol Hapus di UI: snapshot dulu supaya `undo` bisa membatalkan.
export function deleteTxWithUndo(id: number): { removed: number; ids: number[] } {
  const before = currentState();
  const res = deleteTxWithIds(id);
  if (res.removed > 0) {
    pushUndo(before, `hapus transaksi #${id}`);
    rememberSnapshot(exportJson());
  }
  return res;
}

// Import transaksi dari CSV secara atomik dengan pencegahan duplikat (bisa di-undo).
export function importCsvWithUndo(csvText: string): {
  imported: number;
  skipped: number;
  duplicates: number;
  skippedTransfers: number;
} {
  const { rows, skipped, skippedTransfers } = parseCSV(csvText);
  if (!rows.length) return { imported: 0, skipped, duplicates: 0, skippedTransfers };
  const before = currentState();
  const fallbackAcc = getAccountByName("Cash") ?? listAccounts()[0];

  const txKey = (
    tanggal: string,
    tipe: string,
    accId: number | null,
    kategori: string,
    jumlah: number,
    catatan: string
  ) => `${tanggal}|${tipe}|${accId ?? ""}|${kategori.toLowerCase()}|${jumlah}|${catatan.trim().toLowerCase()}`;

  const existing = new Set<string>();
  for (const t of listAll()) {
    existing.add(txKey(t.tanggal, t.tipe, t.account_id ?? null, t.kategori, t.jumlah, t.catatan ?? ""));
  }

  let imported = 0;
  let duplicates = 0;
  withTransaction(() => {
    for (const r of rows) {
      const acc = (r.akun ? getAccountByName(r.akun) : undefined) ?? fallbackAcc;
      const accId = acc?.id ?? null;
      const key = txKey(r.tanggal, r.tipe, accId, r.kategori, r.jumlah, r.catatan);
      if (existing.has(key)) {
        duplicates++;
        continue;
      }
      addTx({
        tanggal: r.tanggal,
        tipe: r.tipe,
        kategori: r.kategori,
        jumlah: r.jumlah,
        catatan: r.catatan || undefined,
        account_id: accId,
      });
      existing.add(key);
      imported++;
    }
  });
  if (imported > 0) {
    pushUndo(before, `import CSV (${imported} tx)`);
    rememberSnapshot(exportJson());
  }
  return { imported, skipped, duplicates, skippedTransfers };
}

// Restore dari UI juga harus bisa di-undo (import mengganti seluruh DB).
export function importJsonWithUndo(json: string): void {
  const before = currentState();
  importJson(json);
  const after = exportJson();
  if (after !== before) {
    pushUndo(before, "restore backup");
    rememberSnapshot(after);
  }
}

// Transaksi berulang yang jatuh tempo juga masuk undo stack.
export function runRecurringWithUndo(): { created: number; entries: string[] } {
  if (!recurringDue()) return { created: 0, entries: [] };
  const before = currentState();
  const res = runRecurring();
  if (res.created > 0) {
    pushUndo(before, "transaksi berulang otomatis");
    rememberSnapshot(exportJson());
  }
  return res;
}

export async function handleMessage(input: string): Promise<Reply> {
  const text = expandAlias(input.trim());

  if (/^(undo|batalkan|batal)$/i.test(text)) {
    const entry = undoStack.pop();
    if (!entry) return { text: "Tidak ada perubahan untuk dibatalkan." };
    const current = exportJson();
    try {
      restoreSnapshot(entry.snap);
    } catch (e) {
      undoStack.push(entry);
      return { text: "Gagal membatalkan: " + (e as Error).message };
    }
    pushRedo(current, entry.label);
    return {
      text: `Dibatalkan. Data kembali ke kondisi sebelum perintah terakhir.${undoStack.length ? ` (bisa undo ${undoStack.length}× lagi)` : ""}`,
    };
  }

  if (/^(redo|ulangi)$/i.test(text)) {
    const entry = redoStack.pop();
    if (!entry) return { text: "Tidak ada aksi untuk diulang." };
    const current = exportJson();
    try {
      restoreSnapshot(entry.snap);
    } catch (e) {
      redoStack.push(entry);
      return { text: "Gagal mengulang: " + (e as Error).message };
    }
    pushUndoKeepRedo(current, entry.label);
    return {
      text: `Dijalankan ulang. Data kembali ke kondisi setelah aksi yang dibatalkan.${redoStack.length ? ` (bisa redo ${redoStack.length}x lagi)` : ""}`,
    };
  }

  const before = currentState();
  const beforeChanges = totalChanges();
  const r = await handleMessageInner(text);
  // Perintah baca tidak mengubah totalChanges: tidak perlu export snapshot.
  if (totalChanges() !== beforeChanges) {
    const after = exportJson();
    if (after !== before) pushUndo(before, actionLabel(text));
    rememberSnapshot(after);
  }
  return r;
}

async function handleMessageInner(input: string): Promise<Reply> {
  const raw = input.trim();
  // Tanggal di AWAL pesan (mis. "2026-11-11 transfer 10rb bsi ke gopay")
  // tidak boleh menghalangi deteksi perintah berawalan (regex /^perintah/).
  // `text` dipakai untuk deteksi perintah; `raw` tetap dipakai saat parsing
  // transaksi agar tanggal & catatan asli tidak hilang.
  const dateInfo = extractDate(raw);
  const leadDate =
    !!dateInfo.tanggal && dateInfo.cleaned.length > 0 && raw.endsWith(dateInfo.cleaned);
  const text = leadDate ? dateInfo.cleaned : raw;
  const low = text.toLowerCase();

  if (!text) return { text: "Tulis sesuatu, contoh: makan siang 50rb" };
  if (["help", "bantuan", "?"].includes(low)) {
    const map = loadAliases();
    const rows = Object.keys(map)
      .sort()
      .map((a) => `  ${a} → ${map[a]}`);
    return { text: HELP + (rows.length ? `\n\nAlias aktif:\n${rows.join("\n")}` : "") };
  }

  if (["versi", "version", "v"].includes(low)) return { text: `Stacker v${APP_VERSION}` };

  if (low === "alias" || /^alias\s+(?:list|daftar)$/i.test(text)) {
    return { text: aliasesText() };
  }

  const aliasReset = text.match(/^alias\s+reset$/i);
  if (aliasReset) {
    const n = Object.keys(loadAliases()).length;
    saveAliases({});
    return { text: n ? `${n} alias dihapus.` : "Belum ada alias." };
  }

  const aliasDel = text.match(/^alias\s+hapus\s+(\S+)$/i);
  if (aliasDel) {
    const name = aliasDel[1].toLowerCase();
    const map = loadAliases();
    if (!map[name]) return { text: `Alias "${name}" tidak ada.` };
    delete map[name];
    saveAliases(map);
    return { text: `Alias ${name} dihapus.` };
  }

  const aliasSet = text.match(/^alias\s+(\S+)\s+([\s\S]+)$/i);
  if (aliasSet) {
    const name = aliasSet[1].toLowerCase();
    const target = aliasSet[2].trim().toLowerCase().replace(/\s+/g, " ");
    const targetFirst = target.split(/\s+/)[0] ?? "";
    if (!/^[a-z][a-z0-9]{1,15}$/.test(name)) {
      return { text: "Alias harus 2-16 huruf/angka dan diawali huruf. Contoh: `alias tf transfer`" };
    }
    if (target === "reset" || targetFirst === "reset") {
      return { text: "Alias ke `reset` diblokir (perintah berisiko). Pakai `reset` langsung." };
    }
    if (!ALIAS_TARGET_SET.has(targetFirst)) {
      return { text: `Target "${targetFirst}" bukan perintah. Pilihan: ${ALIAS_TARGETS.join(", ")}` };
    }
    if (target.length > 80) return { text: "Target alias terlalu panjang (maks 80 karakter)." };
    if (name === target) return { text: "Alias dan target tidak boleh sama." };
    if (ALIAS_RESERVED.has(name)) {
      return { text: `"${name}" sudah dipakai perintah lain. Pilih nama alias lain.` };
    }
    if (listAccounts().some((a) => a.nama.toLowerCase() === name)) {
      return { text: `"${name}" bentrok dengan nama akun.` };
    }
    if (
      listCategories().some(
        (c) => c.nama.toLowerCase() === name || c.keywords.includes(name)
      )
    ) {
      return { text: `"${name}" bentrok dengan kategori/kata kunci.` };
    }
    const map = loadAliases();
    const old = map[name];
    if (old === undefined && Object.keys(map).length >= 50) {
      return { text: "Maksimal 50 alias. Hapus sebagian dulu." };
    }
    map[name] = target;
    saveAliases(map);
    if (old === undefined) return { text: `Alias ${name} → ${target}.` };
    return {
      text: old === target ? `Alias ${name} memang → ${target}.` : `Alias ${name}: ${old} → ${target}.`,
    };
  }

  if (/^alias\b/.test(low)) {
    return {
      text:
        "Format: `alias` · `alias tf transfer` · `alias hapus tf` · `alias reset`\n" +
        `Target: ${ALIAS_TARGETS.join(", ")}`,
    };
  }

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
        ? "PIN: aktif.\nApp mengunci otomatis setelah 2 menit idle atau saat pindah app.\nUbah/hapus lewat ☰ → Keamanan (keypad visual)."
        : "PIN: nonaktif.\nAtur lewat ☰ → Keamanan (keypad visual).\nPIN hanya mengunci tampilan — data tetap tersimpan di perangkat.",
    };
  }

  if ((m = text.match(/^backup(?:\s+kunci\s+(.+))?$/i))) {
    const pass = (m[1] ?? "").trim();
    const stamp = isoLocal();
    const plain = exportJson();
    if (!pass) {
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
    return {
      text:
        "Backup terenkripsi siap diunduh (AES-GCM 256, PBKDF2).\n" +
        "Simpan kata sandinya — tanpa itu file tak bisa dibuka.",
      file: { name: `stacker-backup-${stamp}.enc.json`, content: enc },
    };
  }

  {
    const rm = text.match(/^reset\s+(transaksi|laporan|semua|kategori|akun)$/i);
    if (rm) {
      const kind = rm[1].toLowerCase();
      const back = {
        name: `backup-pre-reset-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        content: exportJson(),
      };
      const tail = `\nBackup sebelum reset: ${back.name} (unduh otomatis).`;
      if (kind === "kategori") {
        const n = resetCategories();
        return {
          text: `Semua kategori dihapus (${n}) + anggarannya. Transaksi lama tetap ada.${tail}`,
          file: back,
        };
      }
      if (kind === "akun") {
        const r = resetAccounts();
        return {
          text:
            `Semua akun dihapus (${r.accounts}) + ${r.tx} transaksi & ${r.recurring} berulang. ` +
            `Akun default dibuat ulang.${tail}`,
          file: back,
        };
      }
      if (kind === "semua") {
        resetAll();
        return {
          text: `Reset total: semua data kembali ke kondisi awal (akun & kategori default).${tail}`,
          file: back,
        };
      }
      const n = deleteAllTx();
      return {
        text: `Semua transaksi dihapus (${n}). Saldo kini = saldo awal tiap akun.${tail}`,
        file: back,
      };
    }
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
    const toks = before.split(/\s+/).filter(Boolean);
    // Nama boleh multi-kata; token tipe (bank/ewallet/cash) memisahkannya.
    const ti = toks.findIndex((t) => TIPE_AKUN.includes(t.toLowerCase()));
    const tipe = ti >= 0 ? toks[ti].toLowerCase() : "ewallet";
    const nama = (ti >= 0 ? [...toks.slice(0, ti), ...toks.slice(ti + 1)] : toks).join(" ").trim();
    if (!nama) return { text: "Format: `akun tambah <nama> <bank|ewallet|cash> [saldo 1jt]`" };
    if (getAccountByName(nama)) return { text: `Akun "${nama}" sudah ada.` };
    const aliasAcc = aliasConflict([nama]);
    if (aliasAcc) return { text: `Akun tidak dibuat: ${aliasAcc}.` };
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
    const aliasAcc = aliasConflict([baru]);
    if (aliasAcc) return { text: `Akun tidak diubah: ${aliasAcc}.` };
    renameAccount(acc.id, baru);
    return { text: `Akun ${lama} → ${baru}.` };
  }

  if ((m = text.match(/^akun hapus\s+(.+)$/i))) {
    const acc = getAccountByName(m[1]);
    if (!acc) return { text: `Akun "${m[1]}" tidak ada.` };
    const res = deleteAccount(acc.id);
    const parts = [`Akun ${acc.nama} dihapus.`];
    if (res.moved > 0) {
      parts.push(
        res.to
          ? `${res.moved} transaksi dipindah ke akun ${res.to}.`
          : `${res.moved} transaksi kini tanpa akun.`
      );
    }
    if (res.movedRecurring > 0) {
      parts.push(
        res.to
          ? `${res.movedRecurring} transaksi berulang dipindah ke akun ${res.to}.`
          : `${res.movedRecurring} transaksi berulang kini tanpa akun.`
      );
    }
    if (res.moved === 0 && res.movedRecurring === 0) parts.push("Tidak ada transaksi terkait.");
    return { text: parts.join(" ") };
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
        "\n\nTambah: `kategori tambah Sosial | sosial, jimpitan` (pemisah `|`, `:`, atau `=`)\n" +
        "Tanpa pemisah: `kategori tambah Sosial sosial jimpitan` (kata pertama = nama)\n" +
        "Tipe opsional: `masuk`/`keluar`/`keduanya` (default `keduanya`)\n" +
        "Pindah sisi: `kategori sisi Sedekah keduanya`\n" +
        "Kata kunci: `kategori tambahkata Sedekah | infak` · `kategori hapuskata Sedekah | zakat`",
    };
  }

  if ((m = text.match(/^kategori\s+ikon\s+(.+?)\s+(\S+)\s*$/i))) {
    const name = m[1].trim();
    const cat = getCategoryByName(name);
    if (!cat) return { text: `Kategori "${name}" tidak ada.` };
    const id = m[2].toLowerCase();
    const ikon = id === "auto" || id === "otomatis" || id === "-" ? null : id;
    setCategoryIcon(cat.nama, ikon);
    return { text: `Ikon kategori ${cat.nama} → ${ikon ?? "(otomatis)"}.` };
  }

  if ((m = text.match(/^kategori tambahkata\s+(.+)$/i))) {
    const { name, kwRaw } = splitNameKw(m[1].trim());
    const cat = getCategoryByName(name);
    if (!cat) return { text: `Kategori "${name}" tidak ada. Buat: \`kategori tambah ${name}\`` };
    const add = splitKw(kwRaw);
    if (!add.length) return { text: "Format: `kategori tambahkata Sedekah | zakat, infak`" };
    const kept: string[] = [];
    const skipped: string[] = [];
    for (const k of add) {
      const conf = keywordConflict(k, cat.id);
      if (conf) skipped.push(`${k} (${conf})`);
      else kept.push(k);
    }
    const merged = [...new Set([...cat.keywords, ...kept])];
    updateCategoryKeywords(cat.id, merged);
    const added = kept.filter((k) => !cat.keywords.includes(k));
    const note = skipped.length ? `\nDilewati: ${skipped.join("; ")}` : "";
    if (!kept.length) {
      return { text: `Kata kunci tidak ditambah: ${skipped.join("; ")}.` };
    }
    return {
      text:
        `${cat.nama}: +${added.length} kata kunci${added.length ? ` (${added.join(", ")})` : " (tidak ada baru)"}\n` +
        `Kata kunci: ${merged.join(", ")}${note}`,
    };
  }

  if ((m = text.match(/^kategori hapuskata\s+(.+)$/i))) {
    const { name, kwRaw } = splitNameKw(m[1].trim());
    const cat = getCategoryByName(name);
    if (!cat) return { text: `Kategori "${name}" tidak ada.` };
    const del = splitKw(kwRaw);
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

  // Sinonim: "tambah/buat kategori X", "kategori baru X", "hapus kategori X".
  let katText = text;
  const revAdd = text.match(/^(?:tambah|buat)\s+kategori\s+([\s\S]+)$/i);
  const newAdd = text.match(/^kategori\s+baru\s+([\s\S]+)$/i);
  const delKat = text.match(/^hapus\s+kategori\s+([\s\S]+)$/i);
  if (revAdd) katText = `kategori tambah ${revAdd[1]}`;
  else if (newAdd) katText = `kategori tambah ${newAdd[1]}`;
  else if (delKat) katText = `kategori hapus ${delKat[1]}`;

  if ((m = katText.match(/^kategori tambah\s+(.+)$/i))) {
    const { name: rawName, kwRaw } = splitNameKw(m[1].trim());
    let head = rawName;
    let tipe: string | undefined;
    const words = head.split(/\s+/).filter(Boolean);
    for (const t of ["masuk", "keluar", "keduanya"]) {
      if (words.includes(t)) {
        tipe = t;
        head = words.filter((w) => w !== t).join(" ").trim();
        break;
      }
    }
    let nama = head;
    let keywords: string[];
    if (kwRaw) {
      keywords = splitKw(kwRaw);
    } else if (nama.split(/\s+/).filter(Boolean).length > 1) {
      // Tanpa pemisah: kata pertama = nama, sisanya = kata kunci.
      const ws = nama.split(/\s+/).filter(Boolean);
      nama = ws[0];
      keywords = splitKw(ws.slice(1).join(" "));
    } else {
      keywords = [nama.toLowerCase()];
    }
    if (!nama) return { text: "Format: `kategori tambah [masuk|keluar|keduanya] <nama> | <kata kunci>`" };

    const aliasCat = aliasConflict([nama]);
    if (aliasCat) return { text: `Kategori tidak dibuat: ${aliasCat}.` };

    const existing = getCategoryByName(nama);
    const kept: string[] = [];
    const skipped: string[] = [];
    for (const k of keywords) {
      const conf = keywordConflict(k, existing?.id);
      if (conf) skipped.push(`${k} (${conf})`);
      else kept.push(k);
    }
    if (!kept.length) {
      return {
        text: `Kata kunci bentrok semua: ${skipped.join("; ")}. Pilih kata lain atau lihat \`kategori\`.`,
      };
    }
    // Tiada tipe ditentukan → keduanya (bisa masuk & keluar).
    if (!tipe) tipe = "keduanya";
    const note = skipped.length ? ` Dilewati: ${skipped.join("; ")}.` : "";
    if (existing) {
      const merged = [...new Set([...existing.keywords, ...kept])];
      updateCategoryKeywords(existing.id, merged);
      setCategoryTipe(existing.id, tipe);
      return {
        text: `Kategori ${existing.nama} (${tipe}) diperbarui. Kata kunci: ${merged.join(", ")}.${note}`,
      };
    }
    addCategory(nama, kept, tipe);
    return { text: `Kategori ${nama} [${tipe}] ditambah. Kata kunci: ${kept.join(", ")}.${note}` };
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
    const nameConflict = keywordConflict(baru, cat.id);
    if (nameConflict) return { text: `Nama kategori ditolak: "${baru}" ${nameConflict}.` };
    renameCategory(cat.id, baru);
    return { text: `Kategori ${lama} → ${baru}. Riwayat transaksi & anggaran ikut diganti.` };
  }

  if ((m = text.match(/^kategori ubah\s+(.+)$/i))) {
    const { name, kwRaw } = splitNameKw(m[1].trim());
    const cat = getCategoryByName(name);
    if (!cat) return { text: `Kategori "${name}" tidak ada. Buat: \`kategori tambah ${name} | kws\`` };
    const list = kwRaw ? splitKw(kwRaw) : [name.toLowerCase()];
    const kept: string[] = [];
    const skipped: string[] = [];
    for (const k of list) {
      const conf = keywordConflict(k, cat.id);
      if (conf) skipped.push(`${k} (${conf})`);
      else kept.push(k);
    }
    if (!kept.length) {
      return { text: `Kata kunci tidak diganti: semua bentrok — ${skipped.join("; ")}.` };
    }
    updateCategoryKeywords(cat.id, kept);
    const note = skipped.length ? ` Dilewati: ${skipped.join("; ")}.` : "";
    return { text: `Kata kunci ${cat.nama} diganti: ${kept.join(", ")}.${note}` };
  }

  if ((m = katText.match(/^kategori hapus\s+(.+)$/i))) {
    const cat = getCategoryByName(m[1]);
    if (!cat) return { text: `Kategori "${m[1]}" tidak ada.` };
    deleteCategory(cat.id);
    const budgetGone = deleteBudget(cat.nama);
    return {
      text:
        `Kategori ${cat.nama} dihapus. Transaksi lama tetap ada.` +
        (budgetGone ? " Anggarannya ikut dihapus." : ""),
    };
  }

  if ((m = text.match(/^saldo awal\s+(.+)$/i))) {
    const found = accountPrefix(m[1].trim());
    if (!found) return { text: `Akun "${m[1].trim().split(/\s+/)[0]}" tidak ada.` };
    const nominal = parseAmount(found.rest);
    if (nominal == null) return { text: "Contoh: `saldo awal bca 5jt`" };
    setAccountSaldoAwal(found.acc.id, nominal);
    return { text: `Saldo awal ${found.acc.nama} = ${rupiahSigned(nominal)}.` };
  }

  if (/^(?:sesuaikan|betulkan)\b/.test(low)) {
    const rest = text.replace(/^(?:sesuaikan|betulkan)\s+(?:saldo\s+)?/i, "").trim();
    const found = accountPrefix(rest);
    if (!found) {
      return { text: "Format: `sesuaikan <akun> <nominal>`. Contoh: `sesuaikan bsi 100jt`" };
    }
    const target = parseAmount(found.rest.replace(/^(?:ke|jadi|menjadi)\s+/i, ""));
    if (target == null) return { text: "Nominal tidak kebaca. Contoh: `sesuaikan bsi 100jt`" };
    const awal = reconcileAccount(found.acc.id, target);
    return {
      text:
        `Saldo ${found.acc.nama} kini ${rupiahSigned(target)}\n` +
        `(saldo awal diset ${rupiahSigned(awal)}, total transaksi ${rupiahSigned(target - awal)})`,
    };
  }

  if (/^transfer\b/.test(low)) {
    const found = mentionedAccounts(text);
    const parsed = parseLocal(raw);
    const nominal = parsed?.result.jumlah;
    if (found.length < 2) {
      return { text: "Sebut dua akun. Contoh: `transfer 100rb bca ke gopay`" };
    }
    if (!nominal) return { text: "Nominal tidak kebaca. Contoh: `transfer 100rb bca ke gopay`" };
    const from = found[0].acc;
    const to = found[1].acc;
    if (from.id === to.id) return { text: "Akun asal dan tujuan sama." };
    const g = crypto.randomUUID();
    const tanggal = parsed.result.tanggal;
    const keluar = addTx({
      jumlah: nominal,
      tipe: "keluar",
      kategori: "Transfer",
      catatan: `Transfer ke ${to.nama}`,
      account_id: from.id,
      transfer_id: g,
      tanggal,
    });
    const masuk = addTx({
      jumlah: nominal,
      tipe: "masuk",
      kategori: "Transfer",
      catatan: `Transfer dari ${from.nama}`,
      account_id: to.id,
      transfer_id: g,
      tanggal,
    });
    const out = [keluar, masuk];
    const feeM = text.match(
      /\b(?:biaya|fee|admin)\s+(\d[\d.,]*(?:\s*(?:jt|juta|rb|ribu|k)(?![a-zA-Z]))?)/i
    );
    const fee = feeM ? parseAmount(feeM[1]) : undefined;
    if (fee && fee > 0) {
      out.push(
        addTx({
          jumlah: fee,
          tipe: "keluar",
          kategori: "Lainnya",
          catatan: `Biaya transfer ${from.nama} → ${to.nama}`,
          account_id: from.id,
          tanggal,
        })
      );
    }
    return {
      text:
        `Transfer ${rupiah(nominal)}: ${from.nama} → ${to.nama}` +
        (fee && fee > 0 ? ` + biaya ${rupiah(fee)}` : ""),
      txs: out.map(withRupiah),
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
      const { account, per, query } = parseFilter(rest);
      const nm = query.match(/^(\d{1,2})$/);
      if (per || (query && !nm)) {
        return { text: "Format: `laporan arus kas 6` atau `laporan arus kas gopay 6`." };
      }
      const n = Math.min(24, Math.max(2, nm ? Number(nm[1]) : 6));
      const rows = lastMonths(n).map((p) => {
        const r = ringkasRange(p.from, p.to, account?.id);
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
          `Arus kas ${n} bulan terakhir${account ? ` · ${account.nama}` : ""} (tanpa transfer)\n\n${lines.join("\n")}\n\n` +
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

  if (low === "tag" || /^tag\s+(?:list|daftar)$/i.test(text)) {
    const tagMap = new Map<string, { count: number; masuk: number; keluar: number }>();
    for (const t of listAll()) {
      if (t.transfer_id || !t.catatan) continue;
      const tags = new Set(
        (t.catatan.match(/#([a-zA-Z0-9_-]{2,30})/g) ?? []).map((x) => x.toLowerCase())
      );
      for (const tg of tags) {
        const cur = tagMap.get(tg) ?? { count: 0, masuk: 0, keluar: 0 };
        cur.count += 1;
        if (t.tipe === "masuk") cur.masuk += t.jumlah;
        else cur.keluar += t.jumlah;
        tagMap.set(tg, cur);
      }
    }
    if (tagMap.size === 0) {
      return { text: "Belum ada #tag. Tambahkan tag di catatan, mis. `makan 50rb #liburan`." };
    }
    const rows = [...tagMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([tg, v]) => {
        const parts: string[] = [];
        if (v.keluar > 0) parts.push(`-${rupiah(v.keluar)}`);
        if (v.masuk > 0) parts.push(`+${rupiah(v.masuk)}`);
        return `  ${tg} (${v.count}×): ${parts.join(" · ") || "Rp0"}`;
      });
    return {
      text: `Daftar #tag:
${rows.join("\n")}

Lihat detail: \`tag #nama\``,
    };
  }

  if ((m = text.match(/^tag\s+#?([a-zA-Z0-9_-]{2,30})$/i))) {
    const tag = "#" + m[1].toLowerCase();
    const re = new RegExp(`(?<![a-zA-Z0-9_-])${escapeRe(tag)}(?![a-zA-Z0-9_-])`, "i");
    const matched = listAll().filter((t) => !t.transfer_id && t.catatan && re.test(t.catatan));
    if (!matched.length) return { text: `Tidak ada transaksi dengan tag ${tag}.` };
    const masuk = matched.filter((t) => t.tipe === "masuk").reduce((a, t) => a + t.jumlah, 0);
    const keluar = matched.filter((t) => t.tipe === "keluar").reduce((a, t) => a + t.jumlah, 0);
    const byCat = new Map<string, number>();
    for (const t of matched.filter((x) => x.tipe === "keluar")) {
      byCat.set(t.kategori, (byCat.get(t.kategori) ?? 0) + t.jumlah);
    }
    const catLines = [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${rupiah(v)}`);
    const latest = [...matched].reverse().slice(0, 10).map(txLine);
    return {
      text:
        `Tag ${tag} (${matched.length} transaksi)
` +
        `Masuk: ${rupiah(masuk)} · Keluar: ${rupiah(keluar)} · Net: ${rupiahSigned(masuk - keluar)}` +
        (catLines.length ? `

Keluar per kategori:
${catLines.join("\n")}` : "") +
        `

Terbaru:
${latest.join("\n")}`,
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
    const deletedIds = new Set<number>();
    let pairs = 0;
    for (const id of ids) {
      if (deletedIds.has(id)) continue; // duplikat / pasangan yang sudah terhapus
      const res = deleteTxWithIds(id);
      if (res.removed > 0) {
        okIds.push(id);
        if (res.removed > 1) pairs += 1;
        for (const x of res.ids) deletedIds.add(x);
      } else {
        failIds.push(id);
      }
    }
    const parts: string[] = [];
    if (okIds.length) parts.push(`Terhapus: ${okIds.map((i) => `#${i}`).join(", ")}`);
    if (failIds.length) parts.push(`Tidak ada: ${failIds.map((i) => `#${i}`).join(", ")}`);
    if (pairs) parts.push(`(${pairs} transfer ikut terhapus pasangannya)`);
    return { text: parts.join("\n"), removedIds: [...deletedIds] };
  }

  if ((m = low.match(/^ubah\s+#?(\d+)\s+akun\s+(.+)$/))) {
    const id = Number(m[1]);
    const cur = getTx(id);
    if (!cur) return { text: `Id ${id} tidak ada.` };
    if (cur.transfer_id) {
      return {
        text: "Transaksi transfer tidak bisa dipindah satu sisi. Hapus transfer lalu buat ulang.",
      };
    }
    const acc = getAccountByName(m[2]);
    if (!acc) return { text: `Akun "${m[2]}" tidak ada. Lihat: \`akun\`` };
    const tx = updateTx(id, { account_id: acc.id });
    return tx
      ? { text: `#${id} dipindah ke ${acc.nama}.`, txs: [withRupiah(tx)] }
      : { text: `Id ${id} tidak ada.` };
  }

  if ((m = text.match(/^ubah\s+#?(\d+)\s+tanggal\s+(.+)$/i))) {
    const id = Number(m[1]);
    const cur = getTx(id);
    if (!cur) return { text: `Id ${id} tidak ada.` };
    const { tanggal } = extractDate(m[2]);
    if (!tanggal) return { text: "Tanggal tidak kebaca. Contoh: `ubah 3 tanggal kemarin`" };
    if (cur.transfer_id) {
      const legs = updateTransferDate(id, tanggal);
      return legs
        ? { text: `Tanggal transfer → ${tanggal} (2 sisi).`, txs: legs.map(withRupiah) }
        : { text: `Id ${id} tidak ada.` };
    }
    const tx = updateTx(id, { tanggal });
    return tx
      ? { text: `Tanggal #${id} → ${tanggal}.`, txs: [withRupiah(tx)] }
      : { text: `Id ${id} tidak ada.` };
  }

  if ((m = text.match(/^ubah\s+#?(\d+)\s+catatan\s+(.+)$/i))) {
    const id = Number(m[1]);
    const cur = getTx(id);
    if (!cur) return { text: `Id ${id} tidak ada.` };
    if (cur.transfer_id) return { text: "Catatan transfer tidak bisa diubah satu sisi." };
    const tx = updateTx(id, { catatan: m[2].trim() });
    return tx
      ? { text: `Catatan #${id} diperbarui.`, txs: [withRupiah(tx)] }
      : { text: `Id ${id} tidak ada.` };
  }

  if ((m = text.match(/^ubah\s+#?(\d+)\s+kategori\s+(.+)$/i))) {
    const id = Number(m[1]);
    const cur = getTx(id);
    if (!cur) return { text: `Id ${id} tidak ada.` };
    if (cur.transfer_id) return { text: "Kategori transfer tidak bisa diubah satu sisi." };
    const cat = getCategoryByName(m[2]);
    if (!cat) return { text: `Kategori "${m[2]}" tidak ada. Lihat: \`kategori\`` };
    const tx = updateTx(id, { kategori: cat.nama });
    return tx
      ? { text: `Kategori #${id} → ${cat.nama}.`, txs: [withRupiah(tx)] }
      : { text: `Id ${id} tidak ada.` };
  }

  if ((m = low.match(/^ubah\s+#?(\d+)\s+jadi\s+(.+)$/))) {
    const id = Number(m[1]);
    const p = parseLocal(m[2]);
    if (!p) return { text: "Nominal baru tidak kebaca. Contoh: `ubah 3 jadi 60rb`" };
    const cur = getTx(id);
    if (!cur) return { text: `Id ${id} tidak ada.` };
    // Hanya nominal yang diubah: tipe & kategori lama dipertahankan.
    if (cur.transfer_id) {
      const legs = updateTransferAmount(id, p.result.jumlah);
      return legs
        ? {
            text: `Transfer diperbarui: ${rupiah(p.result.jumlah)} (2 sisi).`,
            txs: legs.map(withRupiah),
          }
        : { text: `Id ${id} tidak ada.` };
    }
    const tx = updateTx(id, { jumlah: p.result.jumlah });
    return tx
      ? { text: `Nominal diperbarui: ${rupiah(tx.jumlah)}.`, txs: [withRupiah(tx)] }
      : { text: `Id ${id} tidak ada.` };
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
    const capNote =
      (per || account) && rows.length >= 10000
        ? " Dibatasi 10.000 baris; persempit periode/akun untuk sisanya."
        : "";
    return {
      text: `CSV ${rows.length} transaksi (${label}).${capNote}`,
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
      const { account, per, query } = parseFilter(rest);
      const nm = query.match(/^(\d{1,2})$/);
      if (per || (query && !nm)) {
        return { text: "Format: `grafik tren 6` atau `grafik tren gopay 6`." };
      }
      const n = Math.min(24, Math.max(2, nm ? Number(nm[1]) : 6));
      const rows = lastMonths(n).map((p) => {
        const r = ringkasRange(p.from, p.to, account?.id);
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
          `  ${r.per.label.slice(0, 3)}  +${shortRp(r.masuk).padStart(6)}  -${shortRp(r.keluar).padStart(6)}`
      );
      return {
        text:
          `Tren ${n} bulan terakhir${account ? ` · ${account.nama}` : ""}\n${lines.join("\n")}\n\n` +
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
          .map((a) => `${a.nama} ${shortRpSigned(a.saldo ?? 0)}`);

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
    if ((bm = arg.match(/^(.+?)\s+([\d][\d.,]*(?:\s*(?:jt|juta|rb|ribu|k)(?![a-zA-Z]))?)(?:\s+(mingguan|bulanan))?$/i))) {
      const nama = bm[1].trim();
      const jumlah = parseAmount(bm[2]);
      const periode = (bm[3]?.toLowerCase() as "mingguan" | "bulanan" | undefined) ?? undefined;
      if (jumlah == null || jumlah <= 0) {
        return { text: "Nominal anggaran tidak kebaca. Contoh: `anggaran Makanan 2jt`" };
      }
      setBudget(nama, jumlah, { periode });
      const eff = getBudget(nama)?.periode ?? periode ?? "bulanan";
      const suffix = eff === "mingguan" ? "/minggu" : "/bulan";
      return { text: `Anggaran ${nama} = ${rupiah(jumlah)}${suffix}.` };
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

  if ((m = text.match(/^berulang\s+(aktif|nonaktif|ubah)\s+#?(\d+)(?:\s+(.+))?$/i))) {
    const aksi = m[1].toLowerCase();
    const id = Number(m[2]);
    const rec = listRecurring().find((r) => r.id === id);
    if (!rec) return { text: `Tidak ada #${id}.` };
    if (aksi === "aktif" || aksi === "nonaktif") {
      updateRecurring(id, { aktif: aksi === "aktif" ? 1 : 0 });
      const ran = aksi === "aktif" ? runRecurring() : { created: 0, entries: [] as string[] };
      const tail = ran.created > 0 ? `\nLangsung dicatat: ${ran.entries.join(", ")}` : "";
      return { text: `Transaksi berulang #${id} ${aksi}.${tail}` };
    }

    let rest = (m[3] ?? "").trim();
    let hari = rec.hari;
    let jumlah = rec.jumlah;
    const tiap = rest.match(/\btiap\s+(?:tgl\s+|tanggal\s+)?(\d{1,2})\b/i);
    if (tiap) {
      hari = Number(tiap[1]);
      rest = (rest.slice(0, tiap.index) + rest.slice(tiap.index! + tiap[0].length)).trim();
    }
    if (rest) {
      const p = parseLocal(rest);
      if (!p) return { text: "Nominal tidak kebaca. Contoh: `berulang ubah 3 400rb tiap 10`" };
      jumlah = p.result.jumlah;
    }
    if (!rest && !tiap) {
      return { text: "Format: `berulang ubah 3 400rb tiap 10` (boleh salah satu)." };
    }
    if (hari < 1 || hari > 28) return { text: "Tanggal harus 1-28 (biar aman di semua bulan)." };
    updateRecurring(id, { jumlah, hari });
    return {
      text: `Berulang #${id}: ${rec.catatan} ${rupiah(jumlah)} tiap tgl ${hari}.`,
    };
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
        "Bayar: `bayar utang budi 50rb` · `bayar piutang andi 50rb` · " +
        "`utang hapus 3` · `piutang hapus 4`",
    };
  }

  if ((m = text.match(/^(utang|piutang|hutang)\s+hapus\s+#?(\d+)$/i))) {
    const arah: "utang" | "piutang" = m[1].toLowerCase() === "piutang" ? "piutang" : "utang";
    const id = Number(m[2]);
    const d = getDebt(id);
    if (!d) return { text: `Tidak ada #${id}.` };
    if (d.arah !== arah) {
      return {
        text: `#${id} itu ${d.arah}, bukan ${arah}. Pakai \`${d.arah} hapus ${id}\`.`,
      };
    }
    return {
      text: deleteDebt(id)
        ? `${arah === "utang" ? "Utang" : "Piutang"} #${id} dihapus.`
        : `Tidak ada #${id}.`,
    };
  }

  if ((m = text.match(/^bayar\s+(utang|piutang)\s+(.+?)\s+(\d[\d.,]*(?:\s*(?:jt|juta|rb|ribu|k)(?![a-zA-Z]))?)(?:\s+@(.+))?$/i))) {
    const arah = m[1].toLowerCase() === "utang" ? "utang" : "piutang";
    const nama = m[2].trim();
    const nominal = parseAmount(m[3]);
    if (nominal == null || nominal <= 0) return { text: "Nominal tidak kebaca. Contoh: `bayar utang budi 50rb`" };
    const accName = m[4]?.trim();
    const acc = accName ? getAccountByName(accName) : undefined;
    if (accName && !acc) return { text: `Akun "${accName}" tidak ada. Lihat: \`akun\`` };
    const res = payDebt(arah, nama, nominal);
    if (res.paid === 0) return { text: `Tidak ada ${arah} aktif untuk "${nama}".` };
    const tail = res.sisaTotal > 0 ? `Sisa ${rupiah(res.sisaTotal)}.` : "Lunas.";
    if (acc) {
      const tx = addTx({
        jumlah: res.paid,
        tipe: arah === "utang" ? "keluar" : "masuk",
        kategori: "Lainnya",
        catatan: `${arah === "utang" ? "Bayar utang" : "Terima piutang"} ${res.nama}`,
        account_id: acc.id,
      });
      return {
        text: `${arah === "utang" ? "Utang" : "Piutang"} ${res.nama} dibayar ${rupiah(res.paid)} (${acc.nama}). ${tail}`,
        txs: [withRupiah(tx)],
      };
    }
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
      km = rest.match(new RegExp(`^${prep}\\s+(.+?)\\s+([\\d][\\d.,]*(?:\\s*(?:jt|juta|rb|ribu|k)(?![a-zA-Z]))?)$`, "i"));
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

  if (low === "skor" || low === "kesehatan") {
    const h = computeHealth();
    const lines = h.factors.map((f) => `  ${f.label}: ${f.score}/100 (${f.detail})`);
    return {
      text:
        `Skor kesehatan finansial: ${h.score}/100 — ${h.tier}\n` +
        lines.join("\n") +
        `\n\nSaran: ${h.tip}`,
      pre: true,
    };
  }

  if (low === "alokasi" || low === "50/30/20" || low === "503020") {
    const a = computeAlloc();
    if (a.income <= 0) {
      return { text: "Belum ada pemasukan bulan ini. Catat dulu, mis. `gaji 5jt`." };
    }
    const pctOf = (v: number) => Math.round((v / a.income) * 100);
    const row = (label: string, v: number, target: number) =>
      `  ${label} ${rupiah(v)} (${pctOf(v)}%) · target ${rupiah(target)}`;
    return {
      text:
        `Alokasi 50/30/20 (bulan ini)\nPemasukan: ${rupiah(a.income)}\n\n` +
        row("Kebutuhan", a.needs, a.targetNeeds) + "\n" +
        row("Keinginan", a.wants, a.targetWants) + "\n" +
        row("Tabungan ", a.savings, a.targetSavings) + "\n\n" +
        "Panduan: kebutuhan ≤50%, keinginan ≤30%, tabungan ≥20%.",
      pre: true,
    };
  }

  if (low === "target" || low === "target list" || low === "target daftar") {
    const gs = listGoals();
    if (!gs.length) {
      return {
        text: "Belum ada target. Contoh: `target Dana Darurat 10jt` atau `target Liburan 5jt tempo 2027-06-01`.",
      };
    }
    const lines = gs.map((g) => {
      const pct = g.target > 0 ? Math.min(100, Math.floor((g.terkumpul / g.target) * 100)) : 0;
      const sisa = Math.max(0, g.target - g.terkumpul);
      const tempo = g.tenggat ? ` · tempo ${g.tenggat}` : "";
      return `  #${g.id} ${g.nama}: ${rupiah(g.terkumpul)} / ${rupiah(g.target)} (${pct}%, sisa ${rupiah(sisa)})${tempo}`;
    });
    return {
      text:
        `Target:\n${lines.join("\n")}\n\n` +
        "Isi: `target isi <nama> 500rb` · ambil: `target ambil <nama> 100rb` · hapus: `target hapus <nama>`",
    };
  }

  if ((m = text.match(/^target\s+hapus\s+(.+)$/i))) {
    const nama = m[1].trim();
    const g = getGoalByName(nama);
    if (!g) return { text: `Target "${nama}" tidak ada.` };
    deleteGoal(g.id);
    return { text: `Target ${g.nama} dihapus.` };
  }

  if ((m = text.match(/^target\s+isi\s+(.+?)\s+(\d[\d.,]*(?:\s*(?:jt|juta|rb|ribu|k)(?![a-zA-Z]))?)(?:\s+@(.+))?$/i))) {
    const nama = m[1].trim();
    const g = getGoalByName(nama);
    if (!g) return { text: `Target "${nama}" tidak ada.` };
    const nominal = parseAmount(m[2]);
    if (nominal == null || nominal <= 0) {
      return { text: "Nominal tidak kebaca. Contoh: `target isi Liburan 500rb`" };
    }
    const accName = m[3]?.trim();
    const acc = accName ? getAccountByName(accName) : undefined;
    if (accName && !acc) return { text: `Akun "${accName}" tidak ada. Lihat: \`akun\`` };
    contributeGoal(g.id, nominal);
    const after = getGoalByName(g.nama)!;
    const sisa = Math.max(0, after.target - after.terkumpul);
    const msgText =
      `Target ${after.nama}: ${rupiah(after.terkumpul)} / ${rupiah(after.target)}` +
      (sisa > 0 ? ` (sisa ${rupiah(sisa)})` : " — tercapai!");
    if (acc) {
      const tabCat = getCategoryByName("Tabungan")?.nama ?? "Lainnya";
      const tx = addTx({
        jumlah: nominal,
        tipe: "keluar",
        kategori: tabCat,
        catatan: `Target ${after.nama}`,
        account_id: acc.id,
      });
      return {
        text: `${msgText} (potong ${acc.nama})`,
        txs: [withRupiah(tx)],
      };
    }
    return { text: msgText };
  }

  if ((m = text.match(/^target\s+ambil\s+(.+?)\s+(\d[\d.,]*(?:\s*(?:jt|juta|rb|ribu|k)(?![a-zA-Z]))?)$/i))) {
    const nama = m[1].trim();
    const g = getGoalByName(nama);
    if (!g) return { text: `Target "${nama}" tidak ada.` };
    const nominal = parseAmount(m[2]);
    if (nominal == null || nominal <= 0) {
      return { text: "Nominal tidak kebaca. Contoh: `target ambil Liburan 100rb`" };
    }
    contributeGoal(g.id, -nominal);
    const after = getGoalByName(g.nama)!;
    return { text: `Target ${after.nama}: ${rupiah(after.terkumpul)} / ${rupiah(after.target)}.` };
  }

  if ((m = text.match(/^target\s+(.+?)\s+(\d[\d.,]*(?:\s*(?:jt|juta|rb|ribu|k)(?![a-zA-Z]))?)(?:\s+tempo\s+(\S+))?$/i))) {
    const nama = m[1].trim();
    const nominal = parseAmount(m[2]);
    if (nominal == null || nominal <= 0) {
      return { text: "Nominal tidak kebaca. Contoh: `target Liburan 5jt`" };
    }
    if (getGoalByName(nama)) {
      return { text: `Target "${nama}" sudah ada. Pakai \`target isi\` untuk menambah.` };
    }
    const tenggat = m[3] ? extractDate(m[3]).tanggal ?? null : null;
    if (m[3] && !tenggat) {
      return { text: "Tanggal tempo tak dikenali. Contoh: `target Liburan 5jt tempo 2027-06-01`." };
    }
    const g = addGoal({ nama, target: nominal, tenggat });
    return {
      text:
        `Target #${g.id}: ${g.nama} ${rupiah(g.target)}` +
        `${g.tenggat ? ` (tempo ${g.tenggat})` : ""} dibuat.`,
    };
  }

  const word = low.split(/\s+/)[0];
  if (COMMAND_WORD_SET.has(word)) {
    return { text: `Perintah "${word}" tidak dikenali. Ketik \`help\` untuk daftar perintah.` };
  }

  const account = resolveAccount(raw);
  const { results, usedAI, suggested } = await resolveTransactions(raw);
  if (results.length === 0) {
    return { text: "Nominal tidak kebaca. Contoh: `makan siang 50rb`" };
  }

  const recentTx = listTx(5);
  const nowMs = Date.now();
  const todayIso = isoLocal();
  const dupNotes: string[] = [];
  for (const p of results) {
    const tgl = p.tanggal ?? todayIso;
    const accId = account?.id ?? null;
    const dup = recentTx.find((r) => {
      if (r.jumlah !== p.jumlah || r.tipe !== p.tipe || r.kategori !== p.kategori) return false;
      if ((r.account_id ?? null) !== accId || r.tanggal !== tgl) return false;
      const ts = Date.parse(r.created_at.replace(" ", "T") + "Z");
      return Number.isFinite(ts) && nowMs - ts >= 0 && nowMs - ts <= 120_000;
    });
    if (dup) {
      dupNotes.push(`⚠️ Mirip transaksi #${dup.id} barusan — ketik \`undo\` jika dobel.`);
    }
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
  const head =
    txs.length > 1
      ? `${txs.length} transaksi tercatat (total ${total >= 0 ? "+" : "-"}${rupiah(total)}).`
      : "Tercatat.";
  const warns = txs.map(budgetWarn).filter((w): w is string => !!w);
  const sugNote = suggested ? `(kategori "${suggested}" ditebak dari riwayat — ubah bila salah)` : "";
  const body = [usedAI ? `${head}\n(diproses AI)` : head, sugNote, ...dupNotes, ...warns]
    .filter(Boolean)
    .join("\n");
  return { text: body, txs: txs.map(withRupiah) };
}

// Kata umum yang tak menandakan kategori (agar tebakan riwayat tak mengacau).
const CAT_STOP = new Set([
  "beli", "bayar", "untuk", "dengan", "yang", "dan", "dari", "uang", "sama",
  "top", "via", "tiap", "saya", "juga", "serta", "atau", "lalu", "sudah", "buat",
]);
const catTokens = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((t) => !CAT_STOP.has(t));

// Tebak kategori dari riwayat lokal (tanpa AI): token catatan -> kategori yang
// paling sering menyertai token itu pada transaksi lampau (arah sama & kategori
// valid untuk arah itu, bukan "Lainnya").
function suggestFromHistory(
  catatan: string,
  tipe: "masuk" | "keluar"
): { kategori: string; hits: number } | null {
  const toks = new Set(catTokens(catatan));
  if (toks.size === 0) return null;
  const valid = new Set(listCategories(tipe).map((c) => c.nama));
  const score = new Map<string, number>();
  let total = 0;
  for (const t of searchTx("", { limit: 400 })) {
    if (t.tipe !== tipe) continue;
    if (t.kategori === "Lainnya" || !valid.has(t.kategori)) continue;
    for (const tok of new Set(catTokens(t.catatan ?? ""))) {
      if (!toks.has(tok)) continue;
      score.set(t.kategori, (score.get(t.kategori) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return null;
  let best = "";
  let bestScore = 0;
  for (const [k, s] of score) if (s > bestScore) ((best = k), (bestScore = s));
  // Butuh dukungan cukup & dominan agar tak menebak sembarangan.
  if (bestScore < 2 || bestScore / total < 0.6) return null;
  return { kategori: best, hits: bestScore };
}

async function resolveTransactions(
  text: string
): Promise<{ results: ParseResult[]; usedAI: boolean; suggested: string | null }> {
  const local = parseLocal(text);

  if (local && local.confidence === "high") {
    return { results: [local.result], usedAI: false, suggested: null };
  }

  const multi = parseLocalMulti(text);
  if (multi) return { results: multi.map((m) => m.result), usedAI: false, suggested: null };

  // Kategori tak dikenal? Coba tebak dari riwayat (lokal, hemat AI).
  let suggested: string | null = null;
  if (local && local.result.kategori === "Lainnya") {
    const s = suggestFromHistory(local.result.catatan, local.result.tipe);
    if (s) {
      local.result.kategori = s.kategori;
      suggested = s.kategori;
      // Bila satu-satunya masalah hanya kategori, selesai tanpa AI.
      if (local.reason === "kategori tak dikenal") {
        return { results: [local.result], usedAI: false, suggested };
      }
    }
  }

  const ai = await parseGemini(text);
  if (ai && ai.length > 0) {
    if (local?.result.tanggal) {
      for (const a of ai) if (!a.tanggal) a.tanggal = local.result.tanggal;
    }
    return { results: ai, usedAI: true, suggested: null };
  }

  if (local) return { results: [local.result], usedAI: false, suggested };
  return { results: [], usedAI: false, suggested: null };
}

export interface SubCandidate {
  catatan: string;
  jumlah: number;
  kategori: string;
  count: number;
  hari: number;
  lastDate: string;
}

const daysDiff = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Deteksi langganan dari riwayat: nominal sama, muncul tiap ~bulan (25-35 hari),
// dengan kata (vendor) yang sama. Hasil = saran untuk dijadikan `berulang`.
export function detectSubscriptions(): SubCandidate[] {
  const rows = searchTx("", { limit: 1000 }).filter(
    (t) => t.tipe === "keluar" && !t.transfer_id && t.kategori !== "Transfer"
  );
  const byAmount = new Map<number, Tx[]>();
  for (const t of rows) {
    const arr = byAmount.get(t.jumlah);
    if (arr) arr.push(t);
    else byAmount.set(t.jumlah, [t]);
  }
  const existing = listRecurring();
  const out: SubCandidate[] = [];

  for (const [jumlah, list] of byAmount) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));

    // Semua jarak antar kejadian harus ~1 bulan.
    let monthly = true;
    for (let i = 1; i < sorted.length; i++) {
      const d = daysDiff(sorted[i - 1].tanggal, sorted[i].tanggal);
      if (d < 25 || d > 35) {
        monthly = false;
        break;
      }
    }
    if (!monthly) continue;

    // Butuh kata bersama (vendor sama) di minimal 2 catatan.
    const tokCount = new Map<string, number>();
    for (const t of sorted) {
      for (const tok of new Set(catTokens(t.catatan ?? ""))) {
        tokCount.set(tok, (tokCount.get(tok) ?? 0) + 1);
      }
    }
    const shared = [...tokCount.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
    if (shared.length === 0) continue;

    // Lewati bila sudah ada `berulang` yang cocok (nominal + kata).
    const covered = existing.some(
      (r) => r.jumlah === jumlah && catTokens(r.catatan).some((tok) => shared.includes(tok))
    );
    if (covered) continue;

    const last = sorted[sorted.length - 1];
    const days = sorted.map((t) => Number(t.tanggal.slice(8, 10))).sort((a, b) => a - b);
    const label = shared.slice(0, 3).join(" ");
    out.push({
      catatan: label.charAt(0).toUpperCase() + label.slice(1),
      jumlah,
      kategori: last.kategori,
      count: sorted.length,
      hari: days[Math.floor(days.length / 2)],
      lastDate: last.tanggal,
    });
  }

  return out.sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1)).slice(0, 20);
}

export { aiEnabled };
