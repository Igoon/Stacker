// worker.ts — jalankan SQLite (OPFS sahpool) + seluruh logika bot di worker.
// Alasan: OPFS (SyncAccessHandle) hanya tersedia di Worker, bukan main thread.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { createMiniDb, type MiniDb } from "./mini-sqlite";
import {
  initDb,
  saldo,
  rupiahSigned,
  countTx,
  accountBalances,
  getSetting,
  setSetting,
} from "./db";
import {
  deleteTxWithUndo,
  handleMessage,
  importJsonWithUndo,
  runRecurringWithUndo,
} from "./bot";
import { aiEnabled, aiStats, getAiConfig, setAiConfig } from "./ai";
import { exportJson } from "./backup";
import { decryptJson, encryptJson, hashPin, isEncrypted, safeEqual } from "./crypto";
import { APP_VERSION } from "./version";
import { isoLocal } from "./dates";

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
  | MarkBackupMsg;

let mini: MiniDb;

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
  initDb(mini);
  runRecurringWithUndo();
}

function reply(id: number, payload: unknown): void {
  (self as unknown as Worker).postMessage({ id, ...(payload as object) });
}

let backupNoticeShown = false;

function state() {
  // Catat transaksi berulang yang jatuh tempo (idempotent). Bila ada yang
  // tercatat, kirim sebagai notice sekali ke UI.
  const rec = runRecurringWithUndo();
  const notices: string[] = [];
  if (rec.created > 0) {
    notices.push(`Transaksi berulang otomatis dicatat (${rec.created}):\n${rec.entries.join("\n")}`);
  }

  // Pengingat backup: makin lama makin penting, terutama di iOS (storage bisa
  // dibersihkan). Cukup sekali per pembukaan app.
  const n = countTx();
  const lastBackup = getSetting("last_backup_at");
  if (n > 0 && !backupNoticeShown) {
    if (!lastBackup) {
      notices.push(
        "Belum pernah backup. Ketuk ⬇ Backup (atau ketik `backup`) supaya data aman."
      );
      backupNoticeShown = true;
    } else {
      const ts = new Date(lastBackup + "T00:00:00").getTime();
      const days = Math.floor((Date.now() - ts) / 86_400_000);
      if (Number.isFinite(days) && days >= 14) {
        notices.push(`Backup terakhir ${days} hari lalu. Ketuk ⬇ Backup atau ketik \`backup\`.`);
        backupNoticeShown = true;
      }
    }
  }

  // Chat bersifat ephemeral: jangan kirim riwayat lengkap. Cukup jumlah baris
  // supaya UI bisa menampilkan hint singkat saat pertama dibuka.
  return {
    ok: true,
    version: APP_VERSION,
    saldo: saldo(),
    saldoRupiah: rupiahSigned(saldo()),
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
      const h = getSetting("pin_hash");
      if (!h) {
        reply(msg.id, { ok: true, pinSet: false });
        break;
      }
      const c = await hashPin(
        msg.pin,
        getSetting("pin_salt") ?? undefined,
        Number(getSetting("pin_iter") ?? 120000)
      );
      reply(msg.id, { ok: safeEqual(c.hash, h) });
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
