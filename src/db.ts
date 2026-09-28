import Database from "better-sqlite3";
import path from "node:path";
import { isoLocal } from "./dates";

const dbPath = path.join(process.cwd(), "data.db");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nama       TEXT    NOT NULL UNIQUE,
  tipe       TEXT    NOT NULL,
  saldo_awal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal     TEXT    NOT NULL,
  jumlah      INTEGER NOT NULL,
  tipe        TEXT    NOT NULL CHECK (tipe IN ('masuk','keluar')),
  kategori    TEXT    NOT NULL,
  catatan     TEXT,
  account_id  INTEGER REFERENCES accounts(id),
  transfer_id TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
`);

function hasColumn(table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (c) => c.name === col
  );
}
if (!hasColumn("transactions", "account_id")) {
  db.exec(`ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)`);
}
if (!hasColumn("transactions", "transfer_id")) {
  db.exec(`ALTER TABLE transactions ADD COLUMN transfer_id TEXT`);
}

const DEFAULTS: { nama: string; tipe: string }[] = [
  { nama: "Cash", tipe: "cash" },
  { nama: "BSI", tipe: "bank" },
  { nama: "Jago", tipe: "bank" },
  { nama: "GoPay", tipe: "ewallet" },
  { nama: "OVO", tipe: "ewallet" },
  { nama: "DANA", tipe: "ewallet" },
  { nama: "ShopeePay", tipe: "ewallet" },
  { nama: "Flip", tipe: "ewallet" },
];

{
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n;
  if (count === 0) {
    const ins = db.prepare(`INSERT INTO accounts (nama, tipe) VALUES (?, ?)`);
    const tx = db.transaction(() => DEFAULTS.forEach((a) => ins.run(a.nama, a.tipe)));
    tx();
  }
}

const cash = db.prepare(`SELECT id FROM accounts WHERE nama = 'Cash'`).get() as
  | { id: number }
  | undefined;
if (cash) {
  db.prepare(`UPDATE transactions SET account_id = ? WHERE account_id IS NULL`).run(cash.id);
}

export interface Account {
  id: number;
  nama: string;
  tipe: string;
  saldo_awal: number;
  created_at: string;
  saldo?: number;
  rupiah?: string;
}

export interface Tx {
  id: number;
  tanggal: string;
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  catatan: string | null;
  account_id: number | null;
  transfer_id: string | null;
  created_at: string;
  akun?: string | null;
  rupiah?: string;
}

const today = () => isoLocal();

const TX_SELECT = `
  SELECT t.*, a.nama AS akun
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id`;

export function addTx(input: {
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  catatan?: string;
  tanggal?: string;
  account_id?: number | null;
  transfer_id?: string | null;
}): Tx {
  const info = db
    .prepare(
      `INSERT INTO transactions (tanggal, jumlah, tipe, kategori, catatan, account_id, transfer_id)
       VALUES (@tanggal, @jumlah, @tipe, @kategori, @catatan, @account_id, @transfer_id)`
    )
    .run({
      tanggal: input.tanggal ?? today(),
      jumlah: input.jumlah,
      tipe: input.tipe,
      kategori: input.kategori,
      catatan: input.catatan ?? null,
      account_id: input.account_id ?? null,
      transfer_id: input.transfer_id ?? null,
    });
  return getTx(Number(info.lastInsertRowid))!;
}

export function getTx(id: number): Tx | undefined {
  return db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id) as Tx | undefined;
}

export function listTx(limit = 20): Tx[] {
  return db.prepare(`${TX_SELECT} ORDER BY t.id DESC LIMIT ?`).all(limit) as Tx[];
}

export function listAll(): Tx[] {
  return db.prepare(`${TX_SELECT} ORDER BY t.tanggal ASC, t.id ASC`).all() as Tx[];
}

export function listRange(from: string, to: string): Tx[] {
  return db
    .prepare(`${TX_SELECT} WHERE t.tanggal >= ? AND t.tanggal <= ? ORDER BY t.tanggal ASC, t.id ASC`)
    .all(from, to) as Tx[];
}

export function updateTx(
  id: number,
  fields: Partial<Pick<Tx, "jumlah" | "tipe" | "kategori" | "catatan" | "tanggal" | "account_id">>
): Tx | undefined {
  const cur = getTx(id);
  if (!cur) return undefined;
  const next = { ...cur, ...fields };
  db.prepare(
    `UPDATE transactions
       SET tanggal=@tanggal, jumlah=@jumlah, tipe=@tipe, kategori=@kategori,
           catatan=@catatan, account_id=@account_id
     WHERE id=@id`
  ).run(next);
  return getTx(id);
}

export function deleteTx(id: number): boolean {
  return db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id).changes > 0;
}

export function listAccounts(): Account[] {
  return db.prepare(`SELECT * FROM accounts ORDER BY id ASC`).all() as Account[];
}

export function getAccountByName(nama: string): Account | undefined {
  return db.prepare(`SELECT * FROM accounts WHERE lower(nama) = lower(?)`).get(nama.trim()) as
    | Account
    | undefined;
}

export function addAccount(nama: string, tipe: string, saldo_awal = 0): Account {
  const info = db
    .prepare(`INSERT INTO accounts (nama, tipe, saldo_awal) VALUES (?, ?, ?)`)
    .run(nama.trim(), tipe, saldo_awal);
  return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(Number(info.lastInsertRowid)) as Account;
}

export function deleteAccount(id: number): boolean {
  return db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id).changes > 0;
}

export function setAccountSaldoAwal(id: number, value: number): void {
  db.prepare(`UPDATE accounts SET saldo_awal = ? WHERE id = ?`).run(value, id);
}

export function accountBalance(id: number): number {
  const acc = db.prepare(`SELECT saldo_awal FROM accounts WHERE id = ?`).get(id) as
    | { saldo_awal: number }
    | undefined;
  if (!acc) return 0;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipe='masuk' THEN jumlah ELSE -jumlah END), 0) AS s
         FROM transactions WHERE account_id = ?`
    )
    .get(id) as { s: number };
  return acc.saldo_awal + row.s;
}

export function accountBalances(): Account[] {
  return listAccounts().map((a) => {
    const saldo = accountBalance(a.id);
    return { ...a, saldo, rupiah: rupiahSigned(saldo) };
  });
}

export function saldo(accountId?: number): number {
  if (accountId != null) return accountBalance(accountId);
  const row = db.prepare(`SELECT COALESCE(SUM(saldo_awal), 0) AS s FROM accounts`).get() as {
    s: number;
  };
  const flow = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipe='masuk' THEN jumlah ELSE -jumlah END), 0) AS s
       FROM transactions`
    )
    .get() as { s: number };
  return row.s + flow.s;
}

export function ringkasRange(from: string, to: string, accountId?: number) {
  const where = accountId != null ? `AND account_id = ?` : "";
  const args = accountId != null ? [from, to, accountId] : [from, to];
  return db
    .prepare(
      `SELECT tipe, kategori, SUM(jumlah) AS total
         FROM transactions
        WHERE tanggal >= ? AND tanggal <= ? ${where}
        GROUP BY tipe, kategori
        ORDER BY total DESC`
    )
    .all(...args) as { tipe: string; kategori: string; total: number }[];
}

export const rupiah = (n: number) => "Rp" + Math.abs(n).toLocaleString("id-ID");
export const rupiahSigned = (n: number) => (n < 0 ? "-" : "") + rupiah(n);
