// worker.ts — jalankan SQLite (OPFS sahpool) + seluruh logika bot di worker.
// Alasan: OPFS (SyncAccessHandle) hanya tersedia di Worker, bukan main thread.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { createMiniDb, type MiniDb } from "./mini-sqlite";
import {
  initDb,
  saldo,
  rupiah,
  listTx,
  accountBalances,
  deleteTx,
} from "./db";
import { handleMessage } from "./bot";
import { aiEnabled, aiStats, getAiConfig, setAiConfig } from "./ai";
import { exportJson, importJson } from "./backup";
import { APP_VERSION } from "./version";

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
interface ImportMsg {
  type: "import";
  id: number;
  json: string;
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
type InMsg = ChatMsg | StateMsg | DeleteMsg | ExportMsg | ImportMsg | GetAiMsg | SetAiMsg;

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
  const db = new poolUtil.OpfsSAHPoolDb("/duit.db");
  mini = createMiniDb(sqlite3, db as never);
  initDb(mini);
}

function reply(id: number, payload: unknown): void {
  (self as unknown as Worker).postMessage({ id, ...(payload as object) });
}

function state() {
  const rows = listTx(50).map((t) => ({ ...t, rupiah: rupiah(t.jumlah) }));
  return {
    ok: true,
    version: APP_VERSION,
    saldo: saldo(),
    saldoRupiah: rupiah(saldo()),
    aiEnabled: aiEnabled(),
    ai: aiStats(),
    accounts: accountBalances().map((a) => ({
      id: a.id,
      nama: a.nama,
      tipe: a.tipe,
      saldo: a.saldo ?? 0,
      rupiah: a.rupiah,
    })),
    transactions: rows,
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
      const removed = deleteTx(msg.txId);
      reply(msg.id, { ok: removed > 0, removed });
      break;
    }
    case "export":
      reply(msg.id, { ok: true, json: exportJson() });
      break;
    case "import": {
      try {
        importJson(msg.json);
        reply(msg.id, { ok: true });
      } catch (e) {
        reply(msg.id, { ok: false, error: (e as Error).message });
      }
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
    self.onmessage = (ev: MessageEvent<InMsg>) => {
      onMessage(ev.data).catch((e) => reply(ev.data.id, { ok: false, error: (e as Error).message }));
    };
  })
  .catch((e) => {
    console.error("[worker] boot gagal:", e);
    (self as unknown as Worker).postMessage({ id: -1, type: "error", message: (e as Error).message });
  });

export type { MiniDb };
