import {
  addTx,
  deleteTx,
  listAll,
  listRange,
  listTx,
  ringkasRange,
  rupiah,
  saldo,
  updateTx,
  type Tx,
} from "./db";
import { parseLocal, type ParseResult } from "./parser";
import { parsePeriod } from "./dates";
import { toCSV } from "./csv";
import { aiEnabled, parseGemini } from "./ai";

export interface Reply {
  text: string;
  txs?: Tx[];
  file?: { name: string; content: string };
}

const HELP =
  "Cara pakai:\n" +
  "• Catat: `makan siang 50rb` atau `gaji 5jt`\n" +
  "• Beberapa sekaligus: `parkir 5rb sama kopi 18rb`\n" +
  "• Tanggal: `kemarin makan 50rb`, `tgl 3 bayar kos 1jt`, `3 september jajan 20rb`\n" +
  "• Cek saldo: `saldo`\n" +
  "• Ringkasan: `laporan`, `laporan september`, `laporan minggu lalu`, `laporan 2026-08`\n" +
  "• Export CSV: `csv`, `csv september`, `csv 2026`\n" +
  "• Hapus: `hapus 3` (angka = id)\n" +
  "• Ubah: `ubah 3 jadi 60rb`";

export async function handleMessage(input: string): Promise<Reply> {
  const text = input.trim();
  const low = text.toLowerCase();

  if (!text) return { text: "Tulis sesuatu, contoh: makan siang 50rb" };
  if (["help", "bantuan", "?"].includes(low)) return { text: HELP };
  if (low === "saldo") return { text: `Saldo: ${rupiah(saldo())}` };

  if (/^(laporan|ringkasan|report)\b/.test(low)) {
    const arg = text.replace(/^\s*(laporan|ringkasan|report)\s*/i, "").trim();
    const per = parsePeriod(arg);
    if (!per) {
      return {
        text: "Periode tidak dikenali. Contoh: `laporan september`, `laporan minggu lalu`, `laporan 2026-08`.",
      };
    }
    const rows = ringkasRange(per.from, per.to);
    if (rows.length === 0) return { text: `Belum ada transaksi ${per.label}.` };
    const masuk = rows.filter((r) => r.tipe === "masuk");
    const keluar = rows.filter((r) => r.tipe === "keluar");
    const fmt = (rs: typeof rows) => rs.map((r) => `  ${r.kategori}: ${rupiah(r.total)}`).join("\n");
    const tMasuk = masuk.reduce((a, b) => a + b.total, 0);
    const tKeluar = keluar.reduce((a, b) => a + b.total, 0);
    return {
      text:
        `Ringkasan ${per.label}\n\nMasuk (${rupiah(tMasuk)})\n${fmt(masuk) || "  -"}\n\n` +
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

  if (/^(csv|export)\b/.test(low)) {
    const arg = text.replace(/^\s*(csv|export)\s*/i, "").trim();
    const per = arg ? parsePeriod(arg) : null;
    if (arg && !per) return { text: "Periode tidak dikenali. Contoh: `csv september`, `csv 2026`." };
    const rows = per ? listRange(per.from, per.to) : listAll();
    if (rows.length === 0) return { text: `Tidak ada transaksi${per ? ` ${per.label}` : ""}.` };
    const name = `transaksi-${per ? `${per.from}_${per.to}` : "semua"}.csv`;
    return {
      text: `CSV ${rows.length} transaksi (${per ? per.label : "semua"}).`,
      file: { name, content: toCSV(rows) },
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