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
      db.transaction(() => DEFAULTS.forEach((a) => ins.run(a.nama, a.tipe)));
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
      db.transaction(() =>
        DEFAULT_CATEGORIES.forEach((c) => ins.run(c.nama, JSON.stringify(c.keywords), c.tipe))
      );
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

// Hapus akun. Transaksinya DIPINDAH ke akun fallback (Cash diutamakan) supaya
// tak ada baris yatim: total saldo tetap sama dengan jumlah saldo akun.
export function deleteAccount(id: number): { deleted: boolean; moved: number; to: string | null } {
  return db.transaction(() => {
    const acc = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined;
    if (!acc) return { deleted: false, moved: 0, to: null };

    const fallback =
      (db.prepare(`SELECT * FROM accounts WHERE id <> ? AND lower(nama) = 'cash'`).get(id) as
        | Account
        | undefined) ?? (db.prepare(`SELECT * FROM accounts WHERE id <> ? ORDER BY id ASC`).get(id) as
        | Account
        | undefined);

    let moved = 0;
    if (fallback) {
      moved = db
        .prepare(`UPDATE transactions SET account_id = ? WHERE account_id = ?`)
        .run(fallback.id, id).changes;
    }

    const deleted = db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id).changes > 0;
    return { deleted, moved, to: fallback?.nama ?? null };
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

export interface Budget {
  kategori: string;
  jumlah: number;
}

export function listBudgets(): Budget[] {
  return db.prepare(`SELECT kategori, jumlah FROM budgets ORDER BY kategori ASC`).all() as Budget[];
}

export function getBudget(kategori: string): number | undefined {
  const row = db
    .prepare(`SELECT jumlah FROM budgets WHERE lower(kategori) = lower(?)`)
    .get(kategori.trim()) as { jumlah: number } | undefined;
  return row?.jumlah;
}

// PK budgets case-sensitive, tapi lookup pakai lower(). Upsert manual: cari dulu
// baris yang cocok tanpa peduli huruf besar/kecil supaya tak muncul duplikat
// "Makanan" vs "makanan".
export function setBudget(kategori: string, jumlah: number): void {
  const nama = kategori.trim();
  const row = db
    .prepare(`SELECT kategori FROM budgets WHERE lower(kategori) = lower(?)`)
    .get(nama) as { kategori: string } | undefined;
  if (row) {
    db.prepare(`UPDATE budgets SET jumlah = ? WHERE kategori = ?`).run(jumlah, row.kategori);
    return;
  }
  db.prepare(`INSERT INTO budgets (kategori, jumlah) VALUES (?, ?)`).run(nama, jumlah);
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

// Key settings yang TIDAK ikut export: kredensial + penanda snapshot internal.
const SETTING_EXPORT_SKIP = new Set(["ai_key"]);
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
    settings,
  };
  return JSON.stringify({ version: 2, tables });
}

export function importAll(json: string): void {
  const parsed = JSON.parse(json) as { tables: Record<string, unknown[]> };
  const t = parsed.tables;
  if (!t) throw new Error("Format backup tidak dikenali.");

  // API key AI tidak ikut di backup (lihat exportAll). Pertahankan key lokal
  // yang sudah ada supaya restore tidak mematikan AI pengguna.
  const localAiKey = getSetting("ai_key");

  db.transaction(() => {
    db.exec(`DELETE FROM transactions; DELETE FROM accounts; DELETE FROM categories; DELETE FROM budgets; DELETE FROM recurring; DELETE FROM settings;`);

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

    const insBudget = db.prepare(`INSERT INTO budgets (kategori, jumlah) VALUES (?, ?)`);
    for (const r of t.budgets ?? []) {
      const b = r as { kategori: string; jumlah: number };
      insBudget.run(b.kategori, b.jumlah);
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

    const insSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    for (const r of t.settings ?? []) {
      const s = r as { key: string; value: string | null };
      insSetting.run(s.key, s.value ?? null);
    }
    if (localAiKey) insSetting.run("ai_key", localAiKey);
  });
}
