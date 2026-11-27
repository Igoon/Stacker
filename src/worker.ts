// worker.ts — jalankan SQLite (OPFS sahpool) + seluruh logika bot di worker.
// Alasan: OPFS (SyncAccessHandle) hanya tersedia di Worker, bukan main thread.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { createMiniDb, type MiniDb } from "./mini-sqlite";
import {
  initDb,
  saldo,
  rupiah,
  rupiahSigned,
  listTags,
  listTx,
  countTx,
  countTxSince,
  inspectBackup,
  accountBalances,
  getSetting,
  setSetting,
  listCategories,
  checkIntegrity,
  recurringDue,
  ringkasRange,
  listRecurring,
  listDebts,
  debtTotals,
  findDuplicateGroups,
  searchTx,
  listGoals,
} from "./db";
import {
  budgetOverview,
  canRedo,
  canUndo,
  dashboardData,
  detectSubscriptions,
  bulkDeleteTxWithUndo,
  bulkUpdateTxWithUndo,
  deleteTxWithUndo,
  handleMessage,
  importCsvWithUndo,
  importJsonWithUndo,
  redoCount,
  redoLabel,
  runRecurringWithUndo,
  undoCount,
  undoLabel,
} from "./bot";
import { aiEnabled, aiStats, getAiConfig, setAiConfig } from "./ai";
import { exportJson } from "./backup";
import { toCSV } from "./csv";
import { decryptJson, encryptJson, isEncrypted } from "./crypto";
import { changePin, checkPin, removePin, setPin } from "./pin";
import { APP_VERSION } from "./version";
import { isoLocal, parsePeriod } from "./dates";
import { parseLocal } from "./parser";

interface ChatMsg {
  type: "chat";
  id: number;
  text: string;
}
interface StateMsg {
  type: "state";
  id: number;
}
interface DeleteMsg {
  type: "delete";
  id: number;
  txId: number;
}
interface BulkTxMsg {
  type: "bulktx";
  id: number;
  action: "kategori" | "akun" | "addtag" | "removetag" | "delete";
  ids: number[];
  value?: string;
  accountId?: number;
}
interface DuplicatesMsg {
  type: "duplicates";
  id: number;
}
interface ExportMsg {
  type: "export";
  id: number;
}
interface EncExportMsg {
  type: "backupenc";
  id: number;
  pass: string;
}
interface ImportMsg {
  type: "import";
  id: number;
  json: string;
  pass?: string;
}
interface VerifyBackupMsg {
  type: "verifybackup";
  id: number;
  json: string;
  pass?: string;
}
interface PinCheckMsg {
  type: "pincheck";
  id: number;
  pin: string;
}
interface PinSetMsg {
  type: "pinset";
  id: number;
  pin: string;
}
interface PinChangeMsg {
  type: "pinchange";
  id: number;
  oldPin: string;
  newPin: string;
}
interface PinDelMsg {
  type: "pindel";
  id: number;
  pin: string;
}
interface WipeMsg {
  type: "wipe";
  id: number;
}
interface ListCatMsg {
  type: "listcat";
  id: number;
}
interface ListBudgetMsg {
  type: "listbudget";
  id: number;
}
interface ListAccMsg {
  type: "listacc";
  id: number;
}
interface ListRecurringMsg {
  type: "listrecurring";
  id: number;
}
interface ListDebtMsg {
  type: "listdebt";
  id: number;
}
interface ListTagsMsg {
  type: "listtags";
  id: number;
}
interface SearchMsg {
  type: "search";
  id: number;
  q?: string;
  accountId?: number;
  from?: string;
  to?: string;
  kategori?: string;
  tag?: string;
  tipe?: string;
  minRaw?: string;
  maxRaw?: string;
  limit?: number;
}
interface SubsMsg {
  type: "subscriptions";
  id: number;
}
interface ListGoalsMsg {
  type: "listgoals";
  id: number;
}
interface CheckDataMsg {
  type: "checkdata";
  id: number;
}
interface SetFirstUseMsg {
  type: "setfirstuse";
  id: number;
  at: string;
}
interface DashMsg {
  type: "dashboard";
  id: number;
  period?: string;
}
interface ImportCsvMsg {
  type: "importcsv";
  id: number;
  csv: string;
}
interface ExportCsvMsg {
  type: "exportcsv";
  id: number;
  q?: string;
  accountId?: number;
  from?: string;
  to?: string;
  kategori?: string;
  tag?: string;
  minRaw?: string;
  maxRaw?: string;
}
interface MarkBackupMsg {
  type: "markbackup";
  id: number;
  tanggal?: string;
}
interface GetAiMsg {
  type: "getai";
  id: number;
}
interface SetAiMsg {
  type: "setai";
  id: number;
  provider: string;
  model: string;
  baseUrl: string;
  key: string;
}
type InMsg =
  | ChatMsg
  | StateMsg
  | DeleteMsg
  | BulkTxMsg
  | DuplicatesMsg
  | ExportMsg
  | EncExportMsg
  | ImportMsg
  | VerifyBackupMsg
  | GetAiMsg
  | SetAiMsg
  | PinCheckMsg
  | PinSetMsg
  | PinChangeMsg
  | PinDelMsg
  | WipeMsg
  | ListCatMsg
  | ListBudgetMsg
  | ListAccMsg
  | ListRecurringMsg
  | ListDebtMsg
  | ListTagsMsg
  | SearchMsg
  | SubsMsg
  | ListGoalsMsg
  | CheckDataMsg
  | SetFirstUseMsg
  | DashMsg
  | ExportCsvMsg
  | ImportCsvMsg
  | MarkBackupMsg;

let mini: MiniDb;
// Referensi untuk wipe bersih: tutup koneksi lalu kosongkan file OPFS.
let dbRef: { close(): void } | null = null;
let poolRef: { wipeFiles(): Promise<void> } | null = null;
let unlocked = true;
let wiped = false;

async function boot(): Promise<void> {
  const sqlite3 = await (
    sqlite3InitModule as unknown as (cfg: object) => ReturnType<typeof sqlite3InitModule>
  )({
    locateFile: () => wasmUrl,
    print: console.log,
    printErr: console.error,
  });

  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({});
  const db = new poolUtil.OpfsSAHPoolDb("/stacker.db");
  mini = createMiniDb(sqlite3, db as never);
  dbRef = db;
  poolRef = poolUtil;
  initDb(mini);
  unlocked = !getSetting("pin_hash");
}

function reply(id: number, payload: unknown): void {
  (self as unknown as Worker).postMessage({ id, ...(payload as object) });
}

let backupNoticeShown = false;
let budgetNoticeShown = false;

function state() {
  // Catat transaksi berulang hanya bila ada yang jatuh tempo.
  const notices: string[] = [];
  if (recurringDue()) {
    const rec = runRecurringWithUndo();
    if (rec.created > 0) {
      notices.push(`Transaksi berulang otomatis dicatat (${rec.created}):\n${rec.entries.join("\n")}`);
    }
  }

  // Hitung budgetOverview sekali saja (dipakai untuk pengingat & alerts).
  const budgets = budgetOverview();
  if (!budgetNoticeShown) {
    const over = budgets.filter((b) => b.pct >= 100);
    const near = budgets.filter((b) => b.pct >= 80 && b.pct < 100);
    if (over.length) {
      notices.push("⚠️ Anggaran tembus: " + over.map((b) => `${b.kategori} ${b.pct}%`).join(", "));
    } else if (near.length) {
      notices.push("⚠️ Anggaran hampir: " + near.map((b) => `${b.kategori} ${b.pct}%`).join(", "));
    }
    budgetNoticeShown = true;
  }

  // Pengingat backup bertingkat: 7 hari (lembut), 30 hari (tegas) + jumlah
  // transaksi baru sejak backup terakhir. Cukup sekali per pembukaan app.
  const n = countTx();
  const lastBackup = getSetting("last_backup_at");
  const txSinceBackup = lastBackup ? countTxSince(lastBackup) : n;
  if (n > 0 && !backupNoticeShown) {
    if (!lastBackup) {
      notices.push(
        `Belum pernah backup (${n} transaksi belum dicadangkan). Buka ☰ → Backup & penyimpanan (atau ketik \`backup\`) supaya data aman.`
      );
      backupNoticeShown = true;
    } else {
      const ts = new Date(lastBackup + "T00:00:00").getTime();
      const days = Math.floor((Date.now() - ts) / 86_400_000);
      const txNote = txSinceBackup > 0 ? ` (${txSinceBackup} transaksi baru sejak itu)` : "";
      if (Number.isFinite(days) && days >= 30) {
        notices.push(
          `⚠️ Backup terakhir sudah ${days} hari lalu${txNote}. Segera cadangkan lewat ☰ → Backup & penyimpanan atau ketik \`backup\`.`
        );
        backupNoticeShown = true;
      } else if (Number.isFinite(days) && days >= 7) {
        notices.push(
          `Pengingat backup: terakhir ${days} hari lalu${txNote}. Buka ☰ → Backup & penyimpanan atau ketik \`backup\`.`
        );
        backupNoticeShown = true;
      }
    }
  }

  // Ringkas masuk/keluar bulan berjalan untuk header (tanpa transfer).
  const perBulan = parsePeriod("");
  const rowsBulan = perBulan ? ringkasRange(perBulan.from, perBulan.to) : [];
  const monthMasuk = rowsBulan.filter((r) => r.tipe === "masuk").reduce((a, b) => a + b.total, 0);
  const monthKeluar = rowsBulan.filter((r) => r.tipe === "keluar").reduce((a, b) => a + b.total, 0);

  // Chat bersifat ephemeral: jangan kirim riwayat lengkap. Cukup jumlah baris
  // supaya UI bisa menampilkan hint singkat saat pertama dibuka.
  const curSaldo = saldo();
  return {
    ok: true,
    version: APP_VERSION,
    canUndo: canUndo(),
    canRedo: canRedo(),
    undoLabel: undoLabel(),
    redoLabel: redoLabel(),
    undoCount: undoCount(),
    redoCount: redoCount(),
    firstUseAt: getSetting("first_use_at"),
    alerts: budgets.filter((b) => b.pct >= 100).length + (recurringDue() ? 1 : 0),
    saldo: curSaldo,
    saldoRupiah: rupiahSigned(curSaldo),
    monthMasuk,
    monthKeluar,
    aiEnabled: aiEnabled(),
    ai: aiStats(),
    accounts: accountBalances().map((a) => ({
      id: a.id,
      nama: a.nama,
      tipe: a.tipe,
      saldo: a.saldo ?? 0,
      rupiah: a.rupiah,
    })),
    txCount: n,
    recentTxs: listTx(3).map((t) => ({ ...t, rupiah: rupiah(t.jumlah) })),
    tagNames: listTags(),
    pinSet: !!getSetting("pin_hash"),
    lastBackupAt: lastBackup,
    txSinceBackup,
    notices,
  };
}

async function onMessage(msg: InMsg): Promise<void> {
  if (wiped) {
    reply(msg.id, { ok: false, error: "Data sudah dihapus. Muat ulang halaman untuk mulai baru." });
    return;
  }
  if (!unlocked && msg.type !== "pincheck" && msg.type !== "state") {
    reply(msg.id, { ok: false, locked: true, error: "Aplikasi terkunci. Masukkan PIN terlebih dahulu." });
    return;
  }
  switch (msg.type) {
    case "chat": {
      const r = await handleMessage(msg.text);
      reply(msg.id, { ok: true, ...r });
      break;
    }
    case "state":
      if (!unlocked) {
        reply(msg.id, {
          ok: true,
          locked: true,
          version: APP_VERSION,
          pinSet: true,
          saldo: 0,
          saldoRupiah: "Rp0",
          monthMasuk: 0,
          monthKeluar: 0,
          txCount: 0,
          accounts: [],
          recentTxs: [],
          tagNames: [],
          notices: [],
        });
        break;
      }
      reply(msg.id, state());
      break;
    case "delete": {
      const res = deleteTxWithUndo(msg.txId);
      reply(msg.id, { ok: res.removed > 0, removed: res.removed, ids: res.ids });
      break;
    }
    case "bulktx": {
      const ids = Array.isArray(msg.ids) ? msg.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
      if (!ids.length) {
        reply(msg.id, { ok: false, error: "Pilih minimal 1 transaksi." });
        break;
      }
      if (msg.action === "delete") {
        const res = bulkDeleteTxWithUndo(ids);
        reply(msg.id, { ok: res.removed > 0, removed: res.removed, ids: res.ids });
        break;
      }
      if (msg.action === "kategori") {
        const kat = String(msg.value ?? "").trim();
        if (!kat) {
          reply(msg.id, { ok: false, error: "Kategori wajib dipilih." });
          break;
        }
        const res = bulkUpdateTxWithUndo(ids, { kategori: kat }, `ubah massal kategori (${ids.length} tx)`);
        reply(msg.id, { ok: true, ...res });
        break;
      }
      if (msg.action === "akun") {
        const accId = Number(msg.accountId);
        if (!Number.isInteger(accId) || accId <= 0) {
          reply(msg.id, { ok: false, error: "Akun wajib dipilih." });
          break;
        }
        const res = bulkUpdateTxWithUndo(ids, { account_id: accId }, `ubah massal akun (${ids.length} tx)`);
        reply(msg.id, { ok: true, ...res });
        break;
      }
      if (msg.action === "addtag" || msg.action === "removetag") {
        const tag = String(msg.value ?? "").trim().replace(/^#/, "");
        if (!/^[a-zA-Z0-9_-]{2,30}$/.test(tag)) {
          reply(msg.id, { ok: false, error: "Format tag tidak valid (2-30 huruf/angka)." });
          break;
        }
        const res = bulkUpdateTxWithUndo(
          ids,
          msg.action === "addtag" ? { addTag: tag } : { removeTag: tag },
          `${msg.action === "addtag" ? "tambah" : "hapus"} tag #${tag} (${ids.length} tx)`
        );
        reply(msg.id, { ok: true, ...res });
        break;
      }
      reply(msg.id, { ok: false, error: "Aksi massal tidak dikenal." });
      break;
    }
    case "duplicates": {
      reply(msg.id, { ok: true, groups: findDuplicateGroups() });
      break;
    }
    case "export":
      // Jangan tandai backup di sini: penanda baru ditulis setelah file
      // benar-benar tersimpan (lihat UI: markbackup).
      reply(msg.id, { ok: true, json: exportJson() });
      break;
    case "backupenc": {
      try {
        const pass = msg.pass ?? "";
        if (pass.length < 8) {
          reply(msg.id, { ok: false, error: "Kata sandi minimal 8 karakter." });
          break;
        }
        const enc = await encryptJson(exportJson(), pass);
        reply(msg.id, {
          ok: true,
          file: { name: `stacker-backup-${isoLocal()}.enc.json`, content: enc },
        });
      } catch (e) {
        reply(msg.id, { ok: false, error: (e as Error).message });
      }
      break;
    }
    case "markbackup": {
      const tgl = msg.tanggal ? msg.tanggal.trim() : isoLocal();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl) || Number.isNaN(new Date(tgl + "T00:00:00").getTime())) {
        reply(msg.id, { ok: false, error: "Format tanggal backup tidak valid (gunakan YYYY-MM-DD)." });
        break;
      }
      setSetting("last_backup_at", tgl);
      reply(msg.id, { ok: true });
      break;
    }
    case "listcat":
      reply(msg.id, { ok: true, categories: listCategories() });
      break;
    case "listbudget":
      reply(msg.id, { ok: true, budgets: budgetOverview() });
      break;
    case "listacc":
      reply(msg.id, { ok: true, accounts: accountBalances() });
      break;
    case "listrecurring":
      reply(msg.id, { ok: true, recurring: listRecurring() });
      break;
    case "listdebt":
      reply(msg.id, { ok: true, debts: listDebts(), totals: debtTotals() });
      break;
    case "subscriptions":
      reply(msg.id, { ok: true, subs: detectSubscriptions() });
      break;
    case "listgoals":
      reply(msg.id, { ok: true, goals: listGoals() });
      break;
    case "listtags":
      reply(msg.id, { ok: true, tags: listTags() });
      break;
    case "search": {
      const warnings: string[] = [];
      const amt = (s: string | undefined, label: string): number | undefined => {
        if (!s || !s.trim()) return undefined;
        const p = parseLocal(s);
        if (!p) {
          warnings.push(`Filter ${label} ("${s.trim()}") tidak terbaca dan diabaikan.`);
          return undefined;
        }
        return p.result.jumlah;
      };
      const safeLimit = Math.min(Math.max(1, Math.floor(Number(msg.limit) || 100)), 500);
      reply(msg.id, {
        ok: true,
        warnings,
        results: searchTx(msg.q ?? "", {
          accountId: msg.accountId,
          from: msg.from || undefined,
          to: msg.to || undefined,
          kategori: msg.kategori || undefined,
          tag: msg.tag || undefined,
          tipe: msg.tipe === "masuk" || msg.tipe === "keluar" ? msg.tipe : undefined,
          min: amt(msg.minRaw, "nominal min"),
          max: amt(msg.maxRaw, "nominal maks"),
          limit: safeLimit,
        }),
      });
      break;
    }
    case "checkdata":
      reply(msg.id, { ok: true, issues: checkIntegrity() });
      break;
    case "setfirstuse": {
      // Set hanya bila belum ada dan format tanggal ISO valid.
      const at = typeof msg.at === "string" ? msg.at.trim() : "";
      if (!getSetting("first_use_at") && /^\d{4}-\d{2}-\d{2}/.test(at) && !Number.isNaN(new Date(at).getTime())) {
        setSetting("first_use_at", at);
      }
      reply(msg.id, { ok: true, firstUseAt: getSetting("first_use_at") });
      break;
    }
    case "dashboard":
      reply(msg.id, { ok: true, ...dashboardData(msg.period ?? "") });
      break;
    case "exportcsv": {
      const warnings: string[] = [];
      const amt = (s: string | undefined, label: string): number | undefined => {
        if (!s || !s.trim()) return undefined;
        const p = parseLocal(s);
        if (!p) {
          warnings.push(`Filter ${label} ("${s.trim()}") tidak terbaca dan diabaikan.`);
          return undefined;
        }
        return p.result.jumlah;
      };
      const MAX_CSV = 10000;
      const rawRows = searchTx(msg.q ?? "", {
        accountId: msg.accountId,
        from: msg.from || undefined,
        to: msg.to || undefined,
        kategori: msg.kategori || undefined,
        tag: msg.tag || undefined,
        min: amt(msg.minRaw, "nominal min"),
        max: amt(msg.maxRaw, "nominal maks"),
        limit: MAX_CSV + 1,
      });
      const truncated = rawRows.length > MAX_CSV;
      const rows = (truncated ? rawRows.slice(0, MAX_CSV) : rawRows).reverse();
      if (!rows.length) {
        reply(msg.id, { ok: false, error: "Tidak ada transaksi untuk diekspor." });
        break;
      }
      const range = msg.from || msg.to ? `${msg.from || "awal"}_${msg.to || "akhir"}` : isoLocal();
      reply(msg.id, {
        ok: true,
        count: rows.length,
        truncated,
        warnings,
        file: { name: `stacker-transaksi-${range}.csv`, content: toCSV(rows) },
      });
      break;
    }
    case "wipe": {
      // Hapus total: tutup DB dulu (WAJIB sebelum wipeFiles), lalu kosongkan
      // seluruh file OPFS SAH pool. UI akan reload dan DB dibuka ulang bersih.
      wiped = true;
      try {
        dbRef?.close();
        dbRef = null;
        if (poolRef) await poolRef.wipeFiles();
        poolRef = null;
        reply(msg.id, { ok: true });
      } catch (e) {
        reply(msg.id, {
          ok: false,
          error: `Gagal menghapus semua file lokal (${(e as Error).message}). Muat ulang halaman dan coba lagi.`,
        });
      }
      break;
    }
    case "importcsv": {
      try {
        const res = importCsvWithUndo(msg.csv);
        reply(msg.id, { ok: res.imported > 0, ...res, error: res.imported === 0 ? "Tidak ada baris transaksi valid di file CSV." : undefined });
      } catch (e) {
        reply(msg.id, { ok: false, error: (e as Error).message });
      }
      break;
    }
    case "verifybackup": {
      try {
        let json = msg.json;
        const encrypted = isEncrypted(json);
        if (encrypted) {
          if (!msg.pass) {
            reply(msg.id, {
              ok: false,
              needPass: true,
              error: "File backup terenkripsi. Masukkan kata sandi untuk verifikasi.",
            });
            break;
          }
          json = await decryptJson(json, msg.pass);
        }
        const info = inspectBackup(json);
        reply(msg.id, { ok: true, encrypted, info });
      } catch (e) {
        reply(msg.id, { ok: false, error: (e as Error).message });
      }
      break;
    }
    case "import": {
      try {
        let json = msg.json;
        if (isEncrypted(json)) {
          if (!msg.pass) {
            reply(msg.id, {
              ok: false,
              needPass: true,
              error: "File backup terenkripsi. Masukkan kata sandi.",
            });
            break;
          }
          json = await decryptJson(json, msg.pass);
        }
        importJsonWithUndo(json);
        reply(msg.id, { ok: true });
      } catch (e) {
        reply(msg.id, { ok: false, error: (e as Error).message });
      }
      break;
    }
    case "pincheck": {
      const res = await checkPin(msg.pin);
      if (res.ok) unlocked = true;
      reply(msg.id, res);
      break;
    }
    case "pinset": {
      if (getSetting("pin_hash")) {
        reply(msg.id, { ok: false, error: "PIN sudah aktif. Gunakan menu Ubah PIN." });
        break;
      }
      const res = await setPin(msg.pin);
      if (res.ok) unlocked = true;
      reply(msg.id, res);
      break;
    }
    case "pinchange": {
      reply(msg.id, await changePin(msg.oldPin, msg.newPin));
      break;
    }
    case "pindel": {
      const res = await removePin(msg.pin);
      if (res.ok) unlocked = true;
      reply(msg.id, res);
      break;
    }
    case "getai":
      reply(msg.id, { ok: true, config: getAiConfig() });
      break;
    case "setai": {
      const provider = msg.provider === "openai" ? "openai" : "gemini";
      const model = String(msg.model ?? "").trim();
      const baseUrl = String(msg.baseUrl ?? "").trim();
      const key = String(msg.key ?? "").trim();
      if (model.length > 100) {
        reply(msg.id, { ok: false, error: "Nama model terlalu panjang (maks 100 karakter)." });
        break;
      }
      if (key.length > 300) {
        reply(msg.id, { ok: false, error: "API key terlalu panjang (maks 300 karakter)." });
        break;
      }
      if (baseUrl) {
        if (baseUrl.length > 300) {
          reply(msg.id, { ok: false, error: "Base URL terlalu panjang (maks 300 karakter)." });
          break;
        }
        try {
          const u = new URL(baseUrl);
          if (u.protocol !== "https:" && u.protocol !== "http:") {
            reply(msg.id, { ok: false, error: "Base URL harus diawali http:// atau https://." });
            break;
          }
        } catch {
          reply(msg.id, { ok: false, error: "Format Base URL tidak valid." });
          break;
        }
      }
      setAiConfig({ provider, model, baseUrl, key });
      reply(msg.id, { ok: true, aiEnabled: aiEnabled(), config: getAiConfig() });
      break;
    }
    default:
      reply((msg as { id: number }).id, { ok: false, error: "Perintah worker tidak dikenal." });
      break;
  }
}

boot()
  .then(() => {
    (self as unknown as Worker).postMessage({ id: -1, type: "ready", version: APP_VERSION });
    // Antre pesan: cegah dua kirim bersamaan mencampur snapshot undo / state.
    let queue: Promise<void> = Promise.resolve();
    self.onmessage = (ev: MessageEvent<InMsg>) => {
      queue = queue.then(() => onMessage(ev.data)).catch((e) => {
        reply(ev.data.id, { ok: false, error: (e as Error).message });
      });
    };
  })
  .catch((e) => {
    console.error("[worker] boot gagal:", e);
    const rawMsg = (e as Error).message || String(e);
    const friendly = /NoModificationAllowed|SyncAccessHandle|lock|OPFS/i.test(rawMsg)
      ? "Tab atau jendela Stacker lain masih terbuka. Tutup tab lain lalu muat ulang halaman ini."
      : rawMsg;
    self.onmessage = (ev: MessageEvent<{ id?: number }>) => {
      if (ev.data && typeof ev.data.id === "number") {
        reply(ev.data.id, { ok: false, error: friendly });
      }
    };
    (self as unknown as Worker).postMessage({ id: -1, type: "error", message: friendly });
  });

export type { MiniDb };
