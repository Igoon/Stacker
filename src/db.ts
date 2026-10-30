// db.ts (mobile) — port skema + query dari src/db.ts ke sqlite-wasm oo1.
// Antarmuka fungsi sengaja identik agar bot.ts / parser.ts / csv.ts tak berubah.
import { isoLocal } from "./dates";
import type { MiniDb } from "./mini-sqlite";

let db: MiniDb;

export function initDb(mini: MiniDb): void {
  db = mini;
  db.pragma("journal_mode = WAL"); // no-op di OPFS sahpool
  db.exec("PRAGMA foreign_keys = ON");

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

CREATE TABLE IF NOT EXISTS budgets (
  kategori TEXT PRIMARY KEY,
  jumlah   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  catatan    TEXT    NOT NULL,
  jumlah     INTEGER NOT NULL,
  tipe       TEXT    NOT NULL CHECK (tipe IN ('masuk','keluar')),
  kategori   TEXT    NOT NULL,
  account_id INTEGER REFERENCES accounts(id),
  hari       INTEGER NOT NULL DEFAULT 1,
  mulai      TEXT    NOT NULL,
  terakhir   TEXT,
  aktif      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  arah       TEXT    NOT NULL CHECK (arah IN ('utang','piutang')),
  nama       TEXT    NOT NULL,
  jumlah     INTEGER NOT NULL,
  sisa       INTEGER NOT NULL,
  catatan    TEXT,
  tanggal    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
  if (!hasColumn("budgets", "periode")) {
    db.exec(`ALTER TABLE budgets ADD COLUMN periode TEXT NOT NULL DEFAULT 'bulanan'`);
  }
  if (!hasColumn("budgets", "rollover")) {
    db.exec(`ALTER TABLE budgets ADD COLUMN rollover INTEGER NOT NULL DEFAULT 0`);
  }
  // Migrasi satu kali: jangan paksa Gaji=masuk setiap boot (user boleh ubah).
  if (!getSetting("_migr_gaji_masuk")) {
    db.prepare(`UPDATE categories SET tipe='masuk' WHERE lower(nama)='gaji' AND tipe='keluar'`).run();
    setSetting("_migr_gaji_masuk", "1");
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
    // Seed hanya sekali seumur DB. Kalau user sengaja menghapus semua akun,
    // jangan munculkan default lagi saat reload.
    if (!getSetting("_seed_accounts")) {
      if (count === 0) {
        const ins = db.prepare(`INSERT INTO accounts (nama, tipe) VALUES (?, ?)`);
        db.transaction(() => DEFAULTS.forEach((a) => ins.run(a.nama, a.tipe)));
      }
      setSetting("_seed_accounts", "1");
    }
  }

  const cash = db.prepare(`SELECT id FROM accounts WHERE nama = 'Cash'`).get() as
    | { id: number }
    | undefined;
  if (!getSetting("_migr_null_account")) {
    if (cash) {
      db.prepare(`UPDATE transactions SET account_id = ? WHERE account_id IS NULL`).run(cash.id);
    }
    setSetting("_migr_null_account", "1");
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
    if (!getSetting("_seed_categories")) {
      if (count === 0) {
        const ins = db.prepare(`INSERT INTO categories (nama, keywords, tipe) VALUES (?, ?, ?)`);
        db.transaction(() =>
          DEFAULT_CATEGORIES.forEach((c) => ins.run(c.nama, JSON.stringify(c.keywords), c.tipe))
        );
      }
      setSetting("_seed_categories", "1");
    }
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

export function countTx(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n;
}

export function totalChanges(): number {
  return db.totalChanges();
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

// Ubah nominal transfer di KEDUA sisi supaya pasangan tetap seimbang.
export function updateTransferAmount(id: number, jumlah: number): Tx[] | null {
  const tx = getTx(id);
  if (!tx?.transfer_id) return null;
  const rows = db
    .prepare(`SELECT id FROM transactions WHERE transfer_id = ? ORDER BY id ASC`)
    .all(tx.transfer_id) as { id: number }[];
  db.transaction(() => {
    for (const r of rows) {
      db.prepare(`UPDATE transactions SET jumlah = ? WHERE id = ?`).run(jumlah, r.id);
    }
  });
  return rows.map((r) => getTx(r.id)!).filter(Boolean);
}

// Ubah tanggal transfer di KEDUA sisi.
export function updateTransferDate(id: number, tanggal: string): Tx[] | null {
  const tx = getTx(id);
  if (!tx?.transfer_id) return null;
  const rows = db
    .prepare(`SELECT id FROM transactions WHERE transfer_id = ? ORDER BY id ASC`)
    .all(tx.transfer_id) as { id: number }[];
  db.transaction(() => {
    for (const r of rows) {
      db.prepare(`UPDATE transactions SET tanggal = ? WHERE id = ?`).run(tanggal, r.id);
    }
  });
  return rows.map((r) => getTx(r.id)!).filter(Boolean);
}

export function deleteTxWithIds(id: number): { removed: number; ids: number[] } {
  const tx = getTx(id);
  if (!tx) return { removed: 0, ids: [] };
  if (tx.transfer_id) {
    const rows = db
      .prepare(`SELECT id FROM transactions WHERE transfer_id = ?`)
      .all(tx.transfer_id) as { id: number }[];
    db.prepare(`DELETE FROM transactions WHERE transfer_id = ?`).run(tx.transfer_id);
    return { removed: rows.length, ids: rows.map((r) => r.id) };
  }
  db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id);
  return { removed: 1, ids: [id] };
}

export function deleteTx(id: number): number {
  return deleteTxWithIds(id).removed;
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

export function renameCategory(id: number, nama: string): void {
  const baru = nama.trim();
  const cat = db.prepare(`SELECT nama FROM categories WHERE id = ?`).get(id) as
    | { nama: string }
    | undefined;
  if (!cat) return;
  const lama = cat.nama;
  db.transaction(() => {
    db.prepare(`UPDATE categories SET nama = ? WHERE id = ?`).run(baru, id);
    // Riwayat transaksi & anggaran ikut diganti supaya laporan tetap konsisten.
    db.prepare(`UPDATE transactions SET kategori = ? WHERE lower(kategori) = lower(?)`).run(baru, lama);
    const bOld = db
      .prepare(`SELECT kategori FROM budgets WHERE lower(kategori) = lower(?)`)
      .get(lama) as { kategori: string } | undefined;
    if (bOld) {
      const bNew = db
        .prepare(`SELECT kategori FROM budgets WHERE lower(kategori) = lower(?)`)
        .get(baru) as { kategori: string } | undefined;
      if (bNew) db.prepare(`DELETE FROM budgets WHERE kategori = ?`).run(bOld.kategori);
      else db.prepare(`UPDATE budgets SET kategori = ? WHERE kategori = ?`).run(baru, bOld.kategori);
    }
  });
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

// Hapus akun. Transaksi & transaksi berulang DIPINDAH ke akun fallback (Cash
// diutamakan) supaya tak ada baris yatim/FK error.
export function deleteAccount(id: number): {
  deleted: boolean;
  moved: number;
  movedRecurring: number;
  to: string | null;
} {
  return db.transaction(() => {
    const acc = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined;
    if (!acc) return { deleted: false, moved: 0, movedRecurring: 0, to: null };

    const fallback =
      (db.prepare(`SELECT * FROM accounts WHERE id <> ? AND lower(nama) = 'cash'`).get(id) as
        | Account
        | undefined) ?? (db.prepare(`SELECT * FROM accounts WHERE id <> ? ORDER BY id ASC`).get(id) as
        | Account
        | undefined);

    let moved = 0;
    let movedRecurring = 0;
    if (fallback) {
      moved = db
        .prepare(`UPDATE transactions SET account_id = ? WHERE account_id = ?`)
        .run(fallback.id, id).changes;
      movedRecurring = db
        .prepare(`UPDATE recurring SET account_id = ? WHERE account_id = ?`)
        .run(fallback.id, id).changes;
    } else {
      // Akun terakhir: biarkan baris terkait tanpa akun supaya FK tak menghalangi.
      moved = db
        .prepare(`UPDATE transactions SET account_id = NULL WHERE account_id = ?`)
        .run(id).changes;
      movedRecurring = db
        .prepare(`UPDATE recurring SET account_id = NULL WHERE account_id = ?`)
        .run(id).changes;
    }

    const deleted = db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id).changes > 0;
    return { deleted, moved, movedRecurring, to: fallback?.nama ?? null };
  });
}

export function renameAccount(id: number, nama: string): void {
  db.prepare(`UPDATE accounts SET nama = ? WHERE id = ?`).run(nama.trim(), id);
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

export function ringkasRange(
  from: string,
  to: string,
  accountId?: number,
  includeTransfer = false
) {
  const where = [`tanggal >= ?`, `tanggal <= ?`];
  const args: (string | number)[] = [from, to];
  if (!includeTransfer) where.push(`transfer_id IS NULL`);
  if (accountId != null) {
    where.push(`account_id = ?`);
    args.push(accountId);
  }
  return db
    .prepare(
      `SELECT tipe, kategori, SUM(jumlah) AS total
         FROM transactions
        WHERE ${where.join(" AND ")}
        GROUP BY tipe, kategori
        ORDER BY total DESC`
    )
    .all(...args) as { tipe: string; kategori: string; total: number }[];
}

export function transferRange(
  from: string,
  to: string,
  accountId?: number
): { masuk: number; keluar: number } {
  const where = [`tanggal >= ?`, `tanggal <= ?`, `transfer_id IS NOT NULL`];
  const args: (string | number)[] = [from, to];
  if (accountId != null) {
    where.push(`account_id = ?`);
    args.push(accountId);
  }
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tipe='masuk'  THEN jumlah ELSE 0 END), 0) AS masuk,
         COALESCE(SUM(CASE WHEN tipe='keluar' THEN jumlah ELSE 0 END), 0) AS keluar
       FROM transactions
      WHERE ${where.join(" AND ")}`
    )
    .get(...args) as { masuk: number; keluar: number };
  return row;
}

export function dailySeries(
  from: string,
  to: string,
  accountId?: number,
  includeTransfer = false
): { tanggal: string; masuk: number; keluar: number }[] {
  const where = [`tanggal >= ?`, `tanggal <= ?`];
  const args: (string | number)[] = [from, to];
  if (!includeTransfer) where.push(`transfer_id IS NULL`);
  if (accountId != null) {
    where.push(`account_id = ?`);
    args.push(accountId);
  }
  return db
    .prepare(
      `SELECT tanggal,
              COALESCE(SUM(CASE WHEN tipe='masuk'  THEN jumlah ELSE 0 END), 0) AS masuk,
              COALESCE(SUM(CASE WHEN tipe='keluar' THEN jumlah ELSE 0 END), 0) AS keluar
         FROM transactions
        WHERE ${where.join(" AND ")}
        GROUP BY tanggal
        ORDER BY tanggal ASC`
    )
    .all(...args) as { tanggal: string; masuk: number; keluar: number }[];
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

export type BudgetPeriode = "bulanan" | "mingguan";

export interface Budget {
  kategori: string;
  jumlah: number;
  periode: BudgetPeriode;
  rollover: number;
}

export function listBudgets(): Budget[] {
  return db
    .prepare(`SELECT kategori, jumlah, periode, rollover FROM budgets ORDER BY kategori ASC`)
    .all() as Budget[];
}

export function getBudget(kategori: string): Budget | undefined {
  return db
    .prepare(`SELECT kategori, jumlah, periode, rollover FROM budgets WHERE lower(kategori) = lower(?)`)
    .get(kategori.trim()) as Budget | undefined;
}

// PK budgets case-sensitive, tapi lookup pakai lower(). Upsert manual: cari dulu
// baris yang cocok tanpa peduli huruf besar/kecil supaya tak muncul duplikat
// "Makanan" vs "makanan". Opsi periode/rollover dipertahankan bila tak diisi.
export function setBudget(
  kategori: string,
  jumlah: number,
  opts?: { periode?: BudgetPeriode; rollover?: boolean }
): void {
  const nama = kategori.trim();
  const row = db
    .prepare(`SELECT kategori FROM budgets WHERE lower(kategori) = lower(?)`)
    .get(nama) as { kategori: string } | undefined;
  if (row) {
    if (opts?.periode) {
      db.prepare(`UPDATE budgets SET jumlah = ?, periode = ? WHERE kategori = ?`).run(jumlah, opts.periode, row.kategori);
    } else {
      db.prepare(`UPDATE budgets SET jumlah = ? WHERE kategori = ?`).run(jumlah, row.kategori);
    }
    if (opts?.rollover != null) {
      db.prepare(`UPDATE budgets SET rollover = ? WHERE kategori = ?`).run(opts.rollover ? 1 : 0, row.kategori);
    }
    return;
  }
  db.prepare(`INSERT INTO budgets (kategori, jumlah, periode, rollover) VALUES (?, ?, ?, ?)`).run(
    nama,
    jumlah,
    opts?.periode ?? "bulanan",
    opts?.rollover ? 1 : 0
  );
}

export function deleteBudget(kategori: string): boolean {
  return db
    .prepare(`DELETE FROM budgets WHERE lower(kategori) = lower(?)`)
    .run(kategori.trim()).changes > 0;
}

// ---------- Transaksi berulang (bulanan) ----------
export interface Recurring {
  id: number;
  catatan: string;
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  account_id: number | null;
  hari: number;
  mulai: string;
  terakhir: string | null;
  aktif: number;
}

export function listRecurring(): Recurring[] {
  return db.prepare(`SELECT * FROM recurring ORDER BY id ASC`).all() as Recurring[];
}

export function addRecurring(input: {
  catatan: string;
  jumlah: number;
  tipe: "masuk" | "keluar";
  kategori: string;
  account_id?: number | null;
  hari: number;
  mulai?: string;
}): Recurring {
  const info = db
    .prepare(
      `INSERT INTO recurring (catatan, jumlah, tipe, kategori, account_id, hari, mulai)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.catatan.trim(),
      input.jumlah,
      input.tipe,
      input.kategori,
      input.account_id ?? null,
      Math.min(28, Math.max(1, Math.round(input.hari))),
      input.mulai ?? isoLocal()
    );
  return db.prepare(`SELECT * FROM recurring WHERE id = ?`).get(Number(info.lastInsertRowid)) as Recurring;
}

export function deleteRecurring(id: number): boolean {
  return db.prepare(`DELETE FROM recurring WHERE id = ?`).run(id).changes > 0;
}

export function updateRecurring(
  id: number,
  fields: Partial<Pick<Recurring, "jumlah" | "hari" | "catatan" | "aktif">>
): boolean {
  const cur = listRecurring().find((r) => r.id === id);
  if (!cur) return false;
  db.prepare(
    `UPDATE recurring SET jumlah = ?, hari = ?, catatan = ?, aktif = ? WHERE id = ?`
  ).run(
    fields.jumlah ?? cur.jumlah,
    fields.hari ?? cur.hari,
    fields.catatan ?? cur.catatan,
    fields.aktif ?? cur.aktif,
    id
  );
  return true;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

// Catat transaksi berulang yang sudah jatuh tempo. Idempotent: `terakhir`
// menyimpan tanggal posting terakhir, jadi pemanggilan berulang tak menduplikasi.
export function runRecurring(today = isoLocal()): { created: number; entries: string[] } {
  const t = today.split("-").map(Number);
  const ty = t[0];
  const tm = t[1];
  let created = 0;
  const entries: string[] = [];

  for (const rec of listRecurring().filter((r) => r.aktif)) {
    const anchor = rec.terakhir ?? rec.mulai;
    const a = anchor.split("-").map(Number);
    if (a.length < 2 || !a[0] || !a[1]) continue;

    // Mulai dari bulan setelah posting terakhir (atau bulan `mulai` bila belum pernah).
    let y = a[0];
    let m = a[1] + (rec.terakhir ? 1 : 0);
    while (m > 12) {
      m -= 12;
      y += 1;
    }

    let guard = 0;
    while ((y < ty || (y === ty && m <= tm)) && guard++ < 24) {
      const day = Math.min(rec.hari, daysInMonth(y, m));
      const tanggal = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (tanggal > today) break;

      addTx({
        jumlah: rec.jumlah,
        tipe: rec.tipe,
        kategori: rec.kategori,
        catatan: rec.catatan,
        tanggal,
        account_id: rec.account_id,
      });
      db.prepare(`UPDATE recurring SET terakhir = ? WHERE id = ?`).run(tanggal, rec.id);
      created++;
      entries.push(`${rec.catatan} ${rupiah(rec.jumlah)} (${tanggal})`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }

  return { created, entries };
}

// Cek murah apakah ada transaksi berulang yang jatuh tempo (tanpa menulis).
export function recurringDue(today = isoLocal()): boolean {
  const t = today.split("-").map(Number);
  const ty = t[0];
  const tm = t[1];
  for (const rec of listRecurring().filter((r) => r.aktif)) {
    const anchor = rec.terakhir ?? rec.mulai;
    const a = anchor.split("-").map(Number);
    if (a.length < 2 || !a[0] || !a[1]) continue;
    let y = a[0];
    let m = a[1] + (rec.terakhir ? 1 : 0);
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    let guard = 0;
    while ((y < ty || (y === ty && m <= tm)) && guard++ < 24) {
      const day = Math.min(rec.hari, daysInMonth(y, m));
      const tanggal = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (tanggal > today) break;
      return true;
    }
  }
  return false;
}

// ---------- Utang / piutang (ledger terpisah, tidak mengubah saldo) ----------
export interface Debt {
  id: number;
  arah: "utang" | "piutang";
  nama: string;
  jumlah: number;
  sisa: number;
  catatan: string | null;
  tanggal: string;
}

export function listDebts(onlyOutstanding = true): Debt[] {
  return db
    .prepare(
      `SELECT * FROM debts ${onlyOutstanding ? "WHERE sisa > 0" : ""} ORDER BY arah ASC, nama ASC, id ASC`
    )
    .all() as Debt[];
}

export function addDebt(input: {
  arah: "utang" | "piutang";
  nama: string;
  jumlah: number;
  catatan?: string;
  tanggal?: string;
}): Debt {
  const info = db
    .prepare(
      `INSERT INTO debts (arah, nama, jumlah, sisa, catatan, tanggal)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.arah,
      input.nama.trim(),
      input.jumlah,
      input.jumlah,
      input.catatan ?? null,
      input.tanggal ?? isoLocal()
    );
  return db.prepare(`SELECT * FROM debts WHERE id = ?`).get(Number(info.lastInsertRowid)) as Debt;
}

// Bayar/terima pembayaran: alokasikan ke baris tertua lebih dulu.
export function payDebt(
  arah: "utang" | "piutang",
  nama: string,
  jumlah: number
): { paid: number; sisaTotal: number; nama: string } {
  const rows = db
    .prepare(
      `SELECT * FROM debts WHERE arah = ? AND lower(nama) = lower(?) AND sisa > 0 ORDER BY id ASC`
    )
    .all(arah, nama.trim()) as Debt[];
  let left = jumlah;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, r.sisa);
    db.prepare(`UPDATE debts SET sisa = sisa - ? WHERE id = ?`).run(take, r.id);
    left -= take;
  }
  const paid = jumlah - left;
  const rest = db
    .prepare(`SELECT COALESCE(SUM(sisa),0) AS s FROM debts WHERE arah = ? AND lower(nama) = lower(?)`)
    .get(arah, nama.trim()) as { s: number };
  return { paid, sisaTotal: rest.s, nama: nama.trim() };
}

export function getDebt(id: number): Debt | undefined {
  return db.prepare(`SELECT * FROM debts WHERE id = ?`).get(id) as Debt | undefined;
}

export function deleteDebt(id: number): boolean {
  return db.prepare(`DELETE FROM debts WHERE id = ?`).run(id).changes > 0;
}

export function debtTotals(): { utang: number; piutang: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN arah='utang'   THEN sisa ELSE 0 END),0) AS utang,
         COALESCE(SUM(CASE WHEN arah='piutang' THEN sisa ELSE 0 END),0) AS piutang
       FROM debts`
    )
    .get() as { utang: number; piutang: number };
  return row;
}

// Key settings yang TIDAK ikut export: kredensial + penanda snapshot internal.
const SETTING_EXPORT_SKIP = new Set(["ai_key", "pin_hash", "pin_salt", "pin_iter"]);
const settingExportable = (key: string): boolean =>
  !SETTING_EXPORT_SKIP.has(key) && !key.startsWith("backup_") && key !== "_backup_keys";

// Export/import seluruh isi DB (backup/restore + migrasi antar device).
// API key AI sengaja dibuang supaya file backup aman dibagikan.
export function exportAll(): string {
  const settings = (db.prepare(`SELECT key, value FROM settings ORDER BY key ASC`).all() as {
    key: string;
    value: string | null;
  }[]).filter((s) => settingExportable(s.key));
  const tables: Record<string, unknown[]> = {
    accounts: listAccounts(),
    transactions: db.prepare(`SELECT * FROM transactions ORDER BY id ASC`).all() as unknown[],
    categories: db
      .prepare(`SELECT id, nama, keywords, tipe, created_at FROM categories ORDER BY id ASC`)
      .all() as unknown[],
    budgets: listBudgets(),
    recurring: listRecurring(),
    debts: listDebts(false),
    settings,
  };
  return JSON.stringify({ version: 2, tables });
}

export function importAll(json: string): void {
  const parsed = JSON.parse(json) as { tables: Record<string, unknown[]> };
  const t = parsed.tables;
  if (!t) throw new Error("Format backup tidak dikenali.");

  // API key AI tidak ikut di backup (lihat exportAll). Pertahankan key lokal
  // yang sudah ada supaya restore tidak mematikan AI pengguna. PIN juga lokal:
  // restore dari perangkat lain tak boleh membuka/menghapus kunci perangkat ini.
  const localAiKey = getSetting("ai_key");
  const localPin = {
    hash: getSetting("pin_hash"),
    salt: getSetting("pin_salt"),
    iter: getSetting("pin_iter"),
  };

  db.transaction(() => {
    db.exec(`DELETE FROM transactions; DELETE FROM accounts; DELETE FROM categories; DELETE FROM budgets; DELETE FROM recurring; DELETE FROM debts; DELETE FROM settings;`);

    const insAcc = db.prepare(
      `INSERT INTO accounts (id, nama, tipe, saldo_awal, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    for (const r of t.accounts ?? []) {
      const a = r as { id: number; nama: string; tipe: string; saldo_awal: number; created_at: string };
      insAcc.run(a.id, a.nama, a.tipe, a.saldo_awal, a.created_at);
    }

    const insCat = db.prepare(
      `INSERT INTO categories (id, nama, keywords, tipe, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    for (const r of t.categories ?? []) {
      const c = r as { id: number; nama: string; keywords: string; tipe: string; created_at: string };
      insCat.run(c.id, c.nama, c.keywords, c.tipe, c.created_at);
    }

    const insTx = db.prepare(
      `INSERT INTO transactions (id, tanggal, jumlah, tipe, kategori, catatan, account_id, transfer_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of t.transactions ?? []) {
      const x = r as {
        id: number; tanggal: string; jumlah: number; tipe: string; kategori: string;
        catatan: string | null; account_id: number | null; transfer_id: string | null; created_at: string;
      };
      insTx.run(x.id, x.tanggal, x.jumlah, x.tipe, x.kategori, x.catatan ?? null, x.account_id ?? null, x.transfer_id ?? null, x.created_at);
    }

    const insBudget = db.prepare(
      `INSERT INTO budgets (kategori, jumlah, periode, rollover) VALUES (?, ?, ?, ?)`
    );
    for (const r of t.budgets ?? []) {
      const b = r as { kategori: string; jumlah: number; periode?: string; rollover?: number };
      insBudget.run(b.kategori, b.jumlah, b.periode === "mingguan" ? "mingguan" : "bulanan", b.rollover ? 1 : 0);
    }

    const insRec = db.prepare(
      `INSERT INTO recurring (id, catatan, jumlah, tipe, kategori, account_id, hari, mulai, terakhir, aktif, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of t.recurring ?? []) {
      const x = r as Recurring;
      insRec.run(
        x.id,
        x.catatan,
        x.jumlah,
        x.tipe,
        x.kategori,
        x.account_id ?? null,
        x.hari,
        x.mulai,
        x.terakhir ?? null,
        x.aktif ?? 1,
        (x as unknown as { created_at: string }).created_at
      );
    }

    const insDebt = db.prepare(
      `INSERT INTO debts (id, arah, nama, jumlah, sisa, catatan, tanggal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of t.debts ?? []) {
      const x = r as Debt & { created_at?: string };
      insDebt.run(
        x.id,
        x.arah,
        x.nama,
        x.jumlah,
        x.sisa,
        x.catatan ?? null,
        x.tanggal,
        x.created_at ?? new Date().toISOString()
      );
    }

    const insSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    for (const r of t.settings ?? []) {
      const s = r as { key: string; value: string | null };
      // Kredensial/PIN selalu lokal; backup lama yang memuatnya tak boleh
      // menabrak UNIQUE atau menimpa kunci perangkat ini.
      if (!settingExportable(s.key)) continue;
      insSetting.run(s.key, s.value ?? null);
    }
    if (localAiKey) insSetting.run("ai_key", localAiKey);
    if (localPin.hash && localPin.salt) {
      insSetting.run("pin_hash", localPin.hash);
      insSetting.run("pin_salt", localPin.salt);
      insSetting.run("pin_iter", localPin.iter ?? "120000");
    }
  });
}
