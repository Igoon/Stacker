// Mini-sqlite shim: meniru subset better-sqlite3 di atas sqlite-wasm oo1.
// Cukup untuk kebutuhan src/db.ts (port ke mobile).
import type { Sqlite3Static, Database as Oo1Db, SqlValue } from "@sqlite.org/sqlite-wasm";

export interface MiniStmt {
  get(...args: unknown[]): any;
  all(...args: unknown[]): any[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface MiniDb {
  prepare(sql: string): MiniStmt;
  exec(sql: string): void;
  pragma(_sql: string): void;
  transaction<T>(fn: () => T): T;
  totalChanges(): number;
}

type Row = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

// Ekstrak nama parameter bernama (tanpa prefix) sesuai urutan kemunculan di SQL.
function namedParams(sql: string): string[] {
  const out: string[] = [];
  const re = /[:@$]([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const name = m[1];
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// Ubah argumen bind better-sqlite3 (posisional / objek / varargs) jadi array posisional.
function resolveBind(sql: string, args: unknown[]): SqlValue[] {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0] as SqlValue[];
  if (args.length === 1 && isPlainObject(args[0])) {
    const obj = args[0];
    const names = namedParams(sql);
    return names.map((n) => {
      const v = obj[n] ?? obj["@" + n] ?? obj[":" + n] ?? obj["$" + n];
      return v === undefined ? null : (v as SqlValue);
    });
  }
  return args as SqlValue[];
}

export function createMiniDb(sqlite3: Sqlite3Static, db: Oo1Db): MiniDb {
  const lastId = () => db.selectValue("SELECT last_insert_rowid()") as number | bigint;
  const changes = () => db.changes(false) as number;

  const mini: MiniDb = {
    prepare(sql: string): MiniStmt {
      return {
        get(...args: unknown[]): Row | undefined {
          const bind = resolveBind(sql, args);
          const r = db.selectObject(sql, bind.length ? (bind as never) : undefined);
          return r as Row | undefined;
        },
        all(...args: unknown[]): Row[] {
          const bind = resolveBind(sql, args);
          return db.selectObjects(sql, bind.length ? (bind as never) : undefined) as Row[];
        },
        run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
          const bind = resolveBind(sql, args);
          db.exec({ sql, bind: bind.length ? (bind as never) : undefined });
          return { changes: changes(), lastInsertRowid: lastId() };
        },
      };
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    pragma(): void {
      // WAL tidak dipakai di OPFS sahpool; abaikan.
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn);
    },
    totalChanges(): number {
      return Number(db.selectValue("SELECT total_changes()") ?? 0);
    },
  };

  return mini;
}
