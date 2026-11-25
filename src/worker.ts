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
  listTx,
  countTx,
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
  searchTx,
  listGoals,
} from "./db";
import {
  budgetOverview,
  canRedo,
  canUndo,
  dashboardData,
  detectSubscriptions,
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
interface SearchMsg {
  type: "search";
  id: number;
  q?: string;
  accountId?: number;
  from?: string;
  to?: string;
  kategori?: string;
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
  | ExportMsg
  | EncExportMsg
  | ImportMsg
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
}

function reply(id: number, payload: unknown): void {
  (self as unknown as Worker).postMessage({ id, ...(payload as object) });
}

let backupNoticeShown = false;
let budgetNoticeShown = false;

function state() {
  // Catat transaksi berulang yang jatuh tempo (idempotent). Bila ada yang
  // tercatat, kirim sebagai notice sekali ke UI.
  const rec = runRecurringWithUndo();
  const notices: string[] = [];
  if (rec.created > 0) {
    notices.push(`Transaksi berulang otomatis dicatat (${rec.created}):\n${rec.entries.join("\n")}`);
  }

  // Pengingat anggaran (sekali per pembukaan app): tembus / hampir tembus.
  if (!budgetNoticeShown) {
    const bs = budgetOverview();
    const over = bs.filter((b) => b.pct >= 100);
    const near = bs.filter((b) => b.pct >= 80 && b.pct < 100);
    if (over.length) {
      notices.push("⚠️ Anggaran tembus: " + over.map((b) => `${b.kategori} ${b.pct}%`).join(", "));
      budgetNoticeShown = true;
    } else if (near.length) {
      notices.push("⚠️ Anggaran hampir: " + near.map((b) => `${b.kategori} ${b.pct}%`).join(", "));
      budgetNoticeShown = true;
    }
  }

  // Pengingat backup: makin lama makin penting, terutama di iOS (storage bisa
  // dibersihkan). Cukup sekali per pembukaan app.
  const n = countTx();
  const lastBackup = getSetting("last_backup_at");
  if (n > 0 && !backupNoticeShown) {
    if (!lastBackup) {
      notices.push(
        "Belum pernah backup. Buka Info → Backup & penyimpanan (atau ketik `backup`) supaya data aman."
      );
      backupNoticeShown = true;
    } else {
      const ts = new Date(lastBackup + "T00:00:00").getTime();
      const days = Math.floor((Date.now() - ts) / 86_400_000);
      if (Number.isFinite(days) && days >= 14) {
        notices.push(`Backup terakhir ${days} hari lalu. Buka Info → Backup & penyimpanan atau ketik \`backup\`.`);
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
    alerts: budgetOverview().filter((b) => b.pct >= 100).length + (recurringDue() ? 1 : 0),
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
    pinSet: !!getSetting("pin_hash"),
    lastBackupAt: lastBackup,
    notices,
  };
}

async function onMessage(msg: InMsg): Promise<void> {
  switch (msg.type) {
    case "chat": {
      const r = await handleMessage(msg.text);
      reply(msg.id, { ok: true, ...r });
      break;
    }
    case "state":
      reply(msg.id, state());
      break;
    case "delete": {
      const res = deleteTxWithUndo(msg.txId);
      reply(msg.id, { ok: res.removed > 0, removed: res.removed, ids: res.ids });
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
      setSetting("last_backup_at", msg.tanggal ?? isoLocal());
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
    case "search": {
      const amt = (s?: string): number | undefined => {
        if (!s || !s.trim()) return undefined;
        const p = parseLocal(s);
        return p ? p.result.jumlah : undefined;
      };
      reply(msg.id, {
        ok: true,
        results: searchTx(msg.q ?? "", {
          accountId: msg.accountId,
          from: msg.from || undefined,
          to: msg.to || undefined,
          kategori: msg.kategori || undefined,
          tipe: msg.tipe === "masuk" || msg.tipe === "keluar" ? msg.tipe : undefined,
          min: amt(msg.minRaw),
          max: amt(msg.maxRaw),
          limit: msg.limit ?? 100,
        }),
      });
      break;
    }
    case "checkdata":
      reply(msg.id, { ok: true, issues: checkIntegrity() });
      break;
    case "setfirstuse": {
      // Set hanya bila belum ada (idempotent; migrasi dari localStorage).
      if (!getSetting("first_use_at") && msg.at) setSetting("first_use_at", msg.at);
      reply(msg.id, { ok: true, firstUseAt: getSetting("first_use_at") });
      break;
    }
    case "dashboard":
      reply(msg.id, { ok: true, ...dashboardData(msg.period ?? "") });
      break;
    case "exportcsv": {
      const amt = (s?: string): number | undefined => {
        if (!s || !s.trim()) return undefined;
        const p = parseLocal(s);
        return p ? p.result.jumlah : undefined;
      };
      const rows = searchTx(msg.q ?? "", {
        accountId: msg.accountId,
        from: msg.from || undefined,
        to: msg.to || undefined,
        kategori: msg.kategori || undefined,
        min: amt(msg.minRaw),
        max: amt(msg.maxRaw),
        limit: 10000,
      }).reverse();
      if (!rows.length) {
        reply(msg.id, { ok: false, error: "Tidak ada transaksi untuk diekspor." });
        break;
      }
      const range = msg.from || msg.to ? `${msg.from || "awal"}_${msg.to || "akhir"}` : isoLocal();
      reply(msg.id, {
        ok: true,
        count: rows.length,
        file: { name: `stacker-transaksi-${range}.csv`, content: toCSV(rows) },
      });
      break;
    }
    case "wipe": {
      // Hapus total: tutup DB dulu (WAJIB sebelum wipeFiles), lalu kosongkan
      // seluruh file OPFS SAH pool. UI akan reload dan DB dibuka ulang bersih.
      try {
        dbRef?.close();
        dbRef = null;
        if (poolRef) await poolRef.wipeFiles();
        poolRef = null;
        reply(msg.id, { ok: true });
      } catch (e) {
        reply(msg.id, { ok: false, error: (e as Error).message });
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
      reply(msg.id, await checkPin(msg.pin));
      break;
    }
    case "pinset": {
      reply(msg.id, await setPin(msg.pin));
      break;
    }
    case "pinchange": {
      reply(msg.id, await changePin(msg.oldPin, msg.newPin));
      break;
    }
    case "pindel": {
      reply(msg.id, await removePin(msg.pin));
      break;
    }
    case "getai":
      reply(msg.id, { ok: true, config: getAiConfig() });
      break;
    case "setai": {
      setAiConfig({
        provider: msg.provider === "openai" ? "openai" : "gemini",
        model: msg.model,
        baseUrl: msg.baseUrl,
        key: msg.key,
      });
      reply(msg.id, { ok: true, aiEnabled: aiEnabled(), config: getAiConfig() });
      break;
    }
    default:
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
    (self as unknown as Worker).postMessage({ id: -1, type: "error", message: (e as Error).message });
  });

export type { MiniDb };
