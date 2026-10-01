import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duit-smoke-"));
process.env.DUIT_DB_DIR = dir;

const { handleMessage } = await import("./bot");
const dbmod = await import("./db");

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

await check("transfer dikecualikan dari total laporan, saldo akun tetap berubah", async () => {
  const gopay = dbmod.getAccountByName("GoPay")!;
  const sumKeluar = () =>
    dbmod
      .ringkasRange("2000-01-01", "2099-12-31")
      .filter((r) => r.tipe === "keluar")
      .reduce((a, b) => a + b.total, 0);
  const before = sumKeluar();
  const saldoBefore = dbmod.accountBalance(gopay.id);
  await handleMessage("transfer 7rb bsi ke gopay");
  assert.equal(sumKeluar(), before, "transfer tidak boleh menambah total keluar");
  assert(dbmod.transferRange("2000-01-01", "2099-12-31").keluar >= 7000, "transferRange harus mencatat transfer");
  assert.equal(dbmod.accountBalance(gopay.id) - saldoBefore, 7000, "saldo GoPay harus naik 7000");
});

await check("laporan / grafik / cari tidak kosong", async () => {
  assert((await handleMessage("laporan")).text.length > 0);
  assert((await handleMessage("grafik")).text.length > 0);
  assert((await handleMessage("cari kopi")).text.length > 0);
});

dbmod.db.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} ok, ${fail} fail`);
if (fail > 0) process.exit(1);