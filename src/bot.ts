import {
  addTx,
  deleteTx,
  listTx,
  ringkasBulanIni,
  rupiah,
  saldo,
  updateTx,
  type Tx,
} from "./db";
import { parseLocal, type ParseResult } from "./parser";
import { aiEnabled, parseGemini } from "./ai";

export interface Reply {
  text: string;
  txs?: Tx[];
}

const HELP =
  "Cara pakai:\n" +
  "• Catat: `makan siang 50rb` atau `gaji 5jt`\n" +
  "• Beberapa sekaligus: `parkir 5rb sama kopi 18rb`\n" +
  "• Cek saldo: `saldo`\n" +
  "• Ringkasan bulan ini: `laporan`\n" +
  "• Hapus: `hapus 3` (angka = id)\n" +
  "• Ubah: `ubah 3 jadi 60rb`";

export async function handleMessage(input: string): Promise<Reply> {
  const text = input.trim();
  const low = text.toLowerCase();

  if (!text) return { text: "Tulis sesuatu, contoh: makan siang 50rb" };
  if (["help", "bantuan", "?"].includes(low)) return { text: HELP };
  if (low === "saldo") return { text: `Saldo: ${rupiah(saldo())}` };

  if (["laporan", "ringkasan", "report"].includes(low)) {
    const rows = ringkasBulanIni();
    if (rows.length === 0) return { text: "Belum ada transaksi bulan ini." };
    const masuk = rows.filter((r) => r.tipe === "masuk");
    const keluar = rows.filter((r) => r.tipe === "keluar");
    const fmt = (rs: typeof rows) => rs.map((r) => `  ${r.kategori}: ${rupiah(r.total)}`).join("\n");
    const tMasuk = masuk.reduce((a, b) => a + b.total, 0);
    const tKeluar = keluar.reduce((a, b) => a + b.total, 0);
    return {
      text:
        `Ringkasan bulan ini\n\nMasuk (${rupiah(tMasuk)})\n${fmt(masuk) || "  -"}\n\n` +
        `Keluar (${rupiah(tKeluar)})\n${fmt(keluar) || "  -"}\n\nSelisih: ${rupiah(tMasuk - tKeluar)}`,
    };
  }

  let m: RegExpMatchArray | null;

  if ((m = low.match(/^hapus\s+(\d+)$/))) {
    const id = Number(m[1]);
    return { text: deleteTx(id) ? `Terhapus #${id}.` : `Id ${id} tidak ada.` };
  }

  if ((m = low.match(/^ubah\s+(\d+)\s+jadi\s+(.+)$/))) {
    const id = Number(m[1]);
    const p = parseLocal(m[2]);
    if (!p) return { text: "Nominal baru tidak kebaca. Contoh: `ubah 3 jadi 60rb`" };
    const tx = updateTx(id, { jumlah: p.result.jumlah, tipe: p.result.tipe, kategori: p.result.kategori });
    return tx ? { text: "Diperbarui.", txs: [withRupiah(tx)] } : { text: `Id ${id} tidak ada.` };
  }

  if (["riwayat", "history", "list"].includes(low)) {
    const rows = listTx(10);
    if (rows.length === 0) return { text: "Belum ada transaksi." };
    return {
      text:
        "10 transaksi terakhir:\n" +
        rows
          .map((r) => `#${r.id} ${r.tipe === "masuk" ? "+" : "-"}${rupiah(r.jumlah)} ${r.kategori}`)
          .join("\n"),
    };
  }

  const { results, usedAI } = await resolveTransactions(text);
  if (results.length === 0) {
    return { text: "Nominal tidak kebaca. Contoh: `makan siang 50rb`" };
  }

  const txs = results.map((p) => addTx(p));
  const total = txs.reduce((a, t) => a + (t.tipe === "masuk" ? t.jumlah : -t.jumlah), 0);
  const head =
    txs.length > 1
      ? `${txs.length} transaksi tercatat (total ${total >= 0 ? "+" : "-"}${rupiah(total)}).`
      : "Tercatat.";
  return { text: usedAI ? `${head}\n(diproses AI)` : head, txs: txs.map(withRupiah) };
}

const withRupiah = (t: Tx): Tx => ({ ...t, rupiah: rupiah(t.jumlah) });

async function resolveTransactions(
  text: string
): Promise<{ results: ParseResult[]; usedAI: boolean }> {
  const local = parseLocal(text);

  if (local && local.confidence === "high") {
    return { results: [local.result], usedAI: false };
  }

  const ai = await parseGemini(text);
  if (ai && ai.length > 0) return { results: ai, usedAI: true };

  if (local) return { results: [local.result], usedAI: false };
  return { results: [], usedAI: false };
}

export { aiEnabled };