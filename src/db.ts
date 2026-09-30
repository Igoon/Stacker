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

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nama       TEXT NOT NULL UNIQUE,
  keywords   TEXT NOT NULL DEFAULT '[]',
  tipe       TEXT NOT NULL DEFAULT 'keluar',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
if (!hasColumn("categories", "tipe")) {
  db.exec(`ALTER TABLE categories ADD COLUMN tipe TEXT NOT NULL DEFAULT 'keluar'`);
}
db.prepare(`UPDATE categories SET tipe='masuk' WHERE lower(nama)='gaji' AND tipe='keluar'`).run();

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

const DEFAULT_CATEGORIES: { nama: string; keywords: string[]; tipe: string }[] = [
  { nama: "Makanan", keywords: ["makan", "minum", "sarapan", "kopi", "jajan", "camilan", "resto", "warteg", "nasi", "ayam", "bakso", "indomaret", "alfamart"], tipe: "keluar" },
  { nama: "Transportasi", keywords: ["transport", "ojek", "bensin", "gojek", "grab", "taksi", "parkir", "tol", "kereta", "bus", "angkot", "tiket"], tipe: "keluar" },
  { nama: "Belanja", keywords: ["belanja", "beli", "shopping", "baju", "sepatu", "tokopedia", "shopee"], tipe: "keluar" },
  { nama: "Tagihan", keywords: ["listrik", "air", "internet", "pulsa", "kuota", "tagihan", "token", "wifi", "bpjs", "cicilan", "sewa", "kos"], tipe: "keluar" },
  { nama: "Kesehatan", keywords: ["obat", "dokter", "klinik", "rumah sakit", "vitamin", "apotek"], tipe: "keluar" },
  { nama: "Hiburan", keywords: ["nonton", "bioskop", "game", "topup", "spotify", "netflix", "liburan", "jalan"], tipe: "keluar" },
  { nama: "Gaji", keywords: ["gaji", "upah", "honor", "thr", "bonus"], tipe: "masuk" },
];

{
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM categories`).get() as { n: number }).n;
  if (count === 0) {
    const ins = db.prepare(`INSERT INTO categories (nama, keywords, tipe) VALUES (?, ?, ?)`);
    const tx = db.transaction(() =>
      DEFAULT_CATEGORIES.forEach((c) => ins.run(c.nama, JSON.stringify(c.keywords), c.tipe))
    );
    tx();
  }
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

export interface Category {
  id: number;
  nama: string;
  keywords: string[];
  tipe: string;
  created_at: string;
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

const MAX_SEARCH = 10000;

export function searchTx(
  query: string,
  opts: { accountId?: number; from?: string; to?: string; limit?: number } = {}
): Tx[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 20), MAX_SEARCH);
  const where: string[] = [];
  const args: (string | number)[] = [];

  const q = query.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    where.push(
      `(t.catatan LIKE ? ESCAPE '\\' OR t.kategori LIKE ? ESCAPE '\\' OR a.nama LIKE ? ESCAPE '\\')`
    );
    args.push(like, like, like);
  }
  if (opts.from) {
    where.push(`t.tanggal >= ?`);
    args.push(opts.from);
  }
  if (opts.to) {
    where.push(`t.tanggal <= ?`);
    args.push(opts.to);
  }
  if (opts.accountId != null) {
    where.push(`t.account_id = ?`);
    args.push(opts.accountId);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  args.push(limit);
  return db
    .prepare(`${TX_SELECT} ${clause} ORDER BY t.tanggal DESC, t.id DESC LIMIT ?`)
    .all(...args) as Tx[];
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

export function deleteTx(id: number): number {
  const tx = getTx(id);
  if (!tx) return 0;
  if (tx.transfer_id) {
    return db.prepare(`DELETE FROM transactions WHERE transfer_id = ?`).run(tx.transfer_id).changes;
  }
  return db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id).changes;
}

export function deleteAllTx(): number {
  return db.prepare(`DELETE FROM transactions`).run().changes;
}

export function listAccounts(): Account[] {
  return db.prepare(`SELECT * FROM accounts ORDER BY id ASC`).all() as Account[];
}

export function listCategories(tipe?: "masuk" | "keluar"): Category[] {
  const rows = db
    .prepare(`SELECT id, nama, keywords, tipe, created_at FROM categories ORDER BY id ASC`)
    .all() as { id: number; nama: string; keywords: string; tipe: string; created_at: string }[];
  const cats = rows.map((r) => {
    let keywords: string[] = [];
    try {
      keywords = JSON.parse(r.keywords) as string[];
    } catch {
      keywords = [];
    }
    return { ...r, keywords };
  });
  if (tipe) return cats.filter((c) => c.tipe === tipe || c.tipe === "keduanya");
  return cats;
}

export function categoryNames(tipe?: "masuk" | "keluar"): string[] {
  const names = listCategories(tipe).map((c) => c.nama);
  return [...names, "Lainnya"];
}

export function getCategoryByName(nama: string): Category | undefined {
  return listCategories().find((c) => c.nama.toLowerCase() === nama.trim().toLowerCase());
}

export function addCategory(nama: string, keywords: string[], tipe = "keluar"): Category {
  const info = db
    .prepare(`INSERT INTO categories (nama, keywords, tipe) VALUES (?, ?, ?)`)
    .run(nama.trim(), JSON.stringify(keywords), tipe);
  return {
    id: Number(info.lastInsertRowid),
    nama: nama.trim(),
    keywords,
    tipe,
    created_at: new Date().toISOString(),
  };
}

export function setCategoryTipe(id: number, tipe: string): void {
  db.prepare(`UPDATE categories SET tipe = ? WHERE id = ?`).run(tipe, id);
}

export function deleteCategory(id: number): boolean {
  return db.prepare(`DELETE FROM categories WHERE id = ?`).run(id).changes > 0;
}

export function updateCategoryKeywords(id: number, keywords: string[]): void {
  db.prepare(`UPDATE categories SET keywords = ? WHERE id = ?`).run(JSON.stringify(keywords), id);
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

export function accountFlow(id: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipe='masuk' THEN jumlah ELSE -jumlah END), 0) AS s
         FROM transactions WHERE account_id = ?`
    )
    .get(id) as { s: number };
  return row.s;
}

export function accountBalance(id: number): number {
  const acc = db.prepare(`SELECT saldo_awal FROM accounts WHERE id = ?`).get(id) as
    | { saldo_awal: number }
    | undefined;
  if (!acc) return 0;
  return acc.saldo_awal + accountFlow(id);
}

export function reconcileAccount(id: number, target: number): number {
  const awal = target - accountFlow(id);
  db.prepare(`UPDATE accounts SET saldo_awal = ? WHERE id = ?`).run(awal, id);
  return awal;
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

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    return;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
