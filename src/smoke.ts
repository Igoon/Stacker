// smoke.ts (mobile) — uji logika inti (db + parser + bot) memakai sqlite-wasm
// build Node (in-memory). OPFS sendiri hanya ada di browser, jadi diuji manual
// lewat `npm run dev`. Tes ini memastikan skema/query/parser/bot tak rusak.
import assert from "node:assert/strict";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { createMiniDb } from "./mini-sqlite";

const sqlite3 = await sqlite3InitModule();
const oo1db = new sqlite3.oo1.DB(":memory:");
const mini = createMiniDb(sqlite3, oo1db as never);

const { initDb } = await import("./db");
initDb(mini);

const { handleMessage } = await import("./bot");
const dbmod = await import("./db");
const { parseLocal } = await import("./parser");

let pass = 0;
let fail = 0;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log("ok  - " + name);
  } catch (e) {
    fail++;
    console.error("FAIL- " + name + ": " + (e as Error).message);
  }
}

const last = (r: { txs?: { tipe: string; kategori: string; akun?: string | null; id: number }[] }) =>
  r.txs?.[0];
const count = () => dbmod.listAll().length;

await check("pendapatan gaji masuk ke BSI", async () => {
  const t = last(await handleMessage("gaji 100rb bsi"));
  assert(t, "tidak ada tx");
  assert.equal(t!.tipe, "masuk");
  assert.equal(t!.kategori, "Gaji");
  assert.equal(t!.akun, "BSI");
});

await check("pengeluaran makan -> keluar/Makanan", async () => {
  const t = last(await handleMessage("makan 50rb"));
  assert.equal(t!.tipe, "keluar");
  assert.equal(t!.kategori, "Makanan");
});

await check("transfer dua sisi, hapus satu hapus pasangan", async () => {
  const before = count();
  const r = await handleMessage("transfer 10rb bsi ke gopay");
  assert.equal(r.txs?.length, 2);
  const n = dbmod.deleteTx(r.txs![0].id);
  assert.equal(n, 2);
  assert.equal(count(), before);
});

await check("hapus pakai # dan multi-id", async () => {
  const a = last(await handleMessage("kopi 10rb"));
  const b = last(await handleMessage("kopi 5rb"));
  await handleMessage(`hapus #${a!.id} ${b!.id}`);
  assert(!dbmod.getTx(a!.id));
  assert(!dbmod.getTx(b!.id));
});

await check("akun ubah nama", async () => {
  assert(dbmod.getAccountByName("GoPay"), "GoPay harus ada");
  await handleMessage("akun ubah gopay jadi GoPayX");
  assert(dbmod.getAccountByName("GoPayX"), "nama baru harus ada");
  assert(!dbmod.getAccountByName("GoPay"), "nama lama harus hilang");
  // akun baru tak boleh bentrok dengan akun lain
  const r = await handleMessage("akun ubah gopayx jadi BSI");
  assert(r.text.includes("sudah ada"), "harus tolak nama yang sudah dipakai");
  await handleMessage("akun ubah gopayx jadi GoPay");
});

await check("kategori keduanya: dua arah", async () => {
  await handleMessage("kategori tambah keduanya Sedekah | sedekah, donasi");
  const out = last(await handleMessage("bsi sedekah 1jt"));
  assert.equal(out!.tipe, "keluar");
  assert.equal(out!.kategori, "Sedekah");
  const inn = last(await handleMessage("bsi terima sedekah 1jt"));
  assert.equal(inn!.tipe, "masuk");
  assert.equal(inn!.kategori, "Sedekah");
});

await check("kata perintah tak jadi transaksi", async () => {
  const before = count();
  const r = await handleMessage("hapus apa");
  assert(r.text.includes("Format"));
  assert.equal(count(), before);
});

await check("parser: angka dalam kata", async () => {
  const p = parseLocal("makan lima ribu");
  assert(p, "harus terparse");
  assert.equal(p!.result.jumlah, 5000);
  assert.equal(p!.result.tipe, "keluar");
  assert.equal(p!.result.kategori, "Makanan");
  assert.equal(p!.confidence, "high");
});

await check("parser: word-boundary (kosong bukan Tagihan)", async () => {
  const p = parseLocal("tabungan kosong 10rb");
  assert(p);
  assert.notEqual(p!.result.kategori, "Tagihan");
});

await check("parser: imbuhan tetap cocok (makanan -> Makanan)", async () => {
  const p = parseLocal("makanan 50rb");
  assert.equal(p!.result.kategori, "Makanan");
});

await check("parser: override arah eksplisit", async () => {
  assert.equal(parseLocal("keluar 50rb")!.result.tipe, "keluar");
  assert.equal(parseLocal("masuk 50rb")!.result.tipe, "masuk");
});

await check("parser: arah eksplisit tanpa kategori -> high (hemat AI)", async () => {
  const kel = parseLocal("keluar 50rb");
  assert.equal(kel!.confidence, "high");
  assert.equal(kel!.result.tipe, "keluar");
  assert.equal(kel!.result.kategori, "Lainnya");
  assert.equal(kel!.explicitTipe, true);

  const mas = parseLocal("masuk 50rb");
  assert.equal(mas!.confidence, "high");
  assert.equal(mas!.result.tipe, "masuk");
});

await check("parser: tetap low saat perlu AI", async () => {
  assert.equal(parseLocal("keluar 50")!.confidence, "low");
  assert.equal(parseLocal("servis motor 150rb")!.confidence, "low");
});

await check("transfer dikecualikan dari total laporan", async () => {
  const sumKeluar = () =>
    dbmod
      .ringkasRange("2000-01-01", "2099-12-31")
      .filter((r) => r.tipe === "keluar")
      .reduce((a, b) => a + b.total, 0);
  const before = sumKeluar();
  const gopay = dbmod.getAccountByName("GoPay")!;
  const saldoBefore = dbmod.accountBalance(gopay.id);
  await handleMessage("transfer 7rb bsi ke gopay");
  assert.equal(sumKeluar(), before, "transfer tidak boleh menambah total keluar");
  assert.equal(dbmod.accountBalance(gopay.id) - saldoBefore, 7000);
});

await check("export/import roundtrip utuh", async () => {
  const before = count();
  const json = dbmod.exportAll();
  dbmod.importAll(json);
  assert.equal(count(), before, "import harus menghasilkan jumlah tx sama");
  const json2 = dbmod.exportAll();
  assert.equal(json, json2, "export ulang harus identik");
});

await check("akun hapus: transaksi dipindah, saldo tetap konsisten", async () => {
  await handleMessage("akun tambah TempHapus bank saldo 100rb");
  const temp = dbmod.getAccountByName("TempHapus")!;
  assert(temp, "akun temp harus ada");
  const t = last(await handleMessage("TempHapus makan 25rb"));
  assert.equal(t!.akun, "TempHapus");

  const r = await handleMessage("akun hapus TempHapus");
  assert(r.text.includes("dipindah"), "pesan harus menyebut transaksi dipindah");
  assert(!dbmod.getAccountByName("TempHapus"), "akun harus hilang");

  const moved = dbmod.getTx(t!.id)!;
  assert.equal(moved.account_id, dbmod.getAccountByName("Cash")!.id, "tx pindah ke Cash");
  assert.equal(dbmod.listTx().filter((x) => x.account_id == null).length, 0, "tak boleh ada tx yatim");

  const sumAcc = dbmod.accountBalances().reduce((a, b) => a + (b.saldo ?? 0), 0);
  assert.equal(sumAcc, dbmod.saldo(), "total saldo harus = jumlah saldo akun");
});

await check("anggaran case-insensitive: tak bikin baris ganda", async () => {
  await handleMessage("anggaran Perabot 100rb");
  await handleMessage("anggaran perabot 300rb");
  const rows = dbmod.listBudgets().filter((b) => b.kategori.toLowerCase() === "perabot");
  assert.equal(rows.length, 1, "hanya boleh satu baris anggaran");
  assert.equal(rows[0].jumlah, 300000, "nilai terakhir harus menimpa");
  assert.equal(dbmod.getBudget("PERABOT"), 300000);
  await handleMessage("anggaran hapus perabot");
});

await check("export tak memuat api key AI", async () => {
  dbmod.setSetting("ai_key", "SECRET-KEY-123");
  const json = dbmod.exportAll();
  assert(!json.includes("ai_key"), "ai_key tak boleh ikut export");
  assert(!json.includes("SECRET-KEY-123"), "nilai key tak boleh bocor");
  // Restore tak boleh menghapus key lokal.
  dbmod.importAll(json);
  assert.equal(dbmod.getSetting("ai_key"), "SECRET-KEY-123", "key lokal dipertahankan");
  dbmod.setSetting("ai_key", null);
});

await check("reset transaksi menyertakan file backup", async () => {
  const r = await handleMessage("reset transaksi");
  assert(r.file, "harus ada file backup");
  assert(/\.json$/.test(r.file!.name), "file harus json");
  const parsed = JSON.parse(r.file!.content) as { tables?: { transactions?: unknown[] } };
  assert(parsed.tables?.transactions, "backup harus memuat transaksi");
  assert.equal(count(), 0, "semua transaksi terhapus");
  dbmod.importAll(r.file!.content);
  assert(count() > 0, "restore dari file backup harus jalan");
});

await check("parser: typo 1 huruf tetap lokal (tanpa AI)", async () => {
  const gojex = parseLocal("bsi gojex 8rb");
  assert.equal(gojex!.result.kategori, "Transportasi", "gojex -> gojek");
  assert.equal(gojex!.confidence, "high", "typo wajar tak perlu AI");
  assert.equal(gojex!.result.jumlah, 8000);

  const gajii = parseLocal("gajii 5jt");
  assert.equal(gajii!.result.tipe, "masuk", "gajii -> gaji");
  assert.equal(gajii!.result.kategori, "Gaji");
});

await check("parser: fuzzy tak mengacak kategori", async () => {
  const p = parseLocal("servis motor 150rb");
  assert.equal(p!.confidence, "low", "kata jauh tetap ke AI");
  assert.equal(parseLocal("makanan 50rb")!.result.kategori, "Makanan");
  assert.equal(parseLocal("tabungan kosong 10rb")!.result.kategori !== "Tagihan", true);
});

await check("undo mengembalikan aksi terakhir", async () => {
  const before = count();
  await handleMessage("kopi 12rb");
  assert.equal(count(), before + 1, "transaksi harus masuk");
  const r = await handleMessage("undo");
  assert(r.text.includes("Dibatalkan"), "pesan undo");
  assert.equal(count(), before, "jumlah tx kembali");
});

await check("berulang: catat otomatis, idempotent, hapus", async () => {
  const before = count();
  const r = await handleMessage("berulang listrik 350rb tiap 1");
  assert(r.text.includes("Berulang #"), "harus terdaftar");
  assert.equal(count(), before + 1, "bulan berjalan langsung dicatat");

  const recs = dbmod.listRecurring();
  const rec = recs[recs.length - 1];
  assert(rec && rec.catatan.includes("listrik"), "recurring tersimpan");

  const again = dbmod.runRecurring();
  assert.equal(again.created, 0, "tak boleh dobel di bulan yang sama");
  assert.equal(count(), before + 1);

  await handleMessage(`berulang hapus ${rec.id}`);
  assert(!dbmod.listRecurring().some((x) => x.id === rec.id), "harus terhapus");
});

await check("anggaran: set, peringatan 80%/tembus, list, hapus", async () => {
  await handleMessage("anggaran Hiburan 100rb");
  assert((await handleMessage("anggaran")).text.includes("Hiburan"));
  const r80 = await handleMessage("nonton 90rb");
  assert(r80.text.includes("Anggaran") && !r80.text.includes("tembus"), "harus peringatan 80%");
  const r100 = await handleMessage("nonton 20rb");
  assert(r100.text.includes("tembus"), "harus peringatan tembus");
  await handleMessage("anggaran hapus Hiburan");
  assert(!(await handleMessage("anggaran")).text.includes("Hiburan"));
});

await check("laporan / grafik / cari tidak kosong", async () => {
  assert((await handleMessage("laporan")).text.length > 0);
  assert((await handleMessage("grafik")).text.length > 0);
  assert((await handleMessage("cari kopi")).text.length > 0);
});

console.log(`\n${pass} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
