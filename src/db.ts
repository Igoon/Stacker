import Database from "better-sqlite3";
import path from "node:path";
import { isoLocal } from "./dates";

const dbPath = path.join(process.cwd(), "data.db");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal    TEXT    NOT NULL,
  jumlah     INTEGER NOT NULL,
  tipe       TEXT    NOT NULL CHECK (tipe IN ('masuk','keluar')),
  kategori   TEXT    NOT NULL,
  catatan    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
`);

export interface Tx {
  id: number;
  tanggal: string;
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  catatan: string | null;
  created_at: string;
  rupiah?: string;
}

const today = () => isoLocal();

export function addTx(input: {
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  catatan?: string;
  tanggal?: string;
}): Tx {
  const info = db
    .prepare(
      `INSERT INTO transactions (tanggal, jumlah, tipe, kategori, catatan)
       VALUES (@tanggal, @jumlah, @tipe, @kategori, @catatan)`
    )
    .run({
      tanggal: input.tanggal ?? today(),
      jumlah: input.jumlah,
      tipe: input.tipe,
      kategori: input.kategori,
      catatan: input.catatan ?? null,
    });
  return getTx(Number(info.lastInsertRowid))!;
}

export function getTx(id: number): Tx | undefined {
  return db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Tx | undefined;
}

export function listTx(limit = 20): Tx[] {
  return db
    .prepare(`SELECT * FROM transactions ORDER BY id DESC LIMIT ?`)
    .all(limit) as Tx[];
}

export function updateTx(
  id: number,
  fields: Partial<Pick<Tx, "jumlah" | "tipe" | "kategori" | "catatan" | "tanggal">>
): Tx | undefined {
  const cur = getTx(id);
  if (!cur) return undefined;
  const next = { ...cur, ...fields };
  db.prepare(
    `UPDATE transactions
       SET tanggal=@tanggal, jumlah=@jumlah, tipe=@tipe, kategori=@kategori, catatan=@catatan
     WHERE id=@id`
  ).run(next);
  return getTx(id);
}

export function deleteTx(id: number): boolean {
  return db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id).changes > 0;
}

export function listAll(): Tx[] {
  return db
    .prepare(`SELECT * FROM transactions ORDER BY tanggal ASC, id ASC`)
    .all() as Tx[];
}

export function listRange(from: string, to: string): Tx[] {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE tanggal >= ? AND tanggal <= ? ORDER BY tanggal ASC, id ASC`
    )
    .all(from, to) as Tx[];
}

export function saldo(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipe='masuk' THEN jumlah ELSE -jumlah END), 0) AS s
       FROM transactions`
    )
    .get() as { s: number };
  return row.s;
}

export function ringkasRange(from: string, to: string) {
  return db
    .prepare(
      `SELECT tipe, kategori, SUM(jumlah) AS total
         FROM transactions
        WHERE tanggal >= ? AND tanggal <= ?
        GROUP BY tipe, kategori
        ORDER BY total DESC`
    )
    .all(from, to) as { tipe: string; kategori: string; total: number }[];
}

export const rupiah = (n: number) =>
  "Rp" + Math.abs(n).toLocaleString("id-ID");
