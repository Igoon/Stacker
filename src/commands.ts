// commands.ts — sumber tunggal kata perintah (kata pertama) untuk bot & UI.
// Dipakai bot (deteksi perintah tak dikenal) dan main (share target) supaya
// daftar tak lagi drift antar tempat.
export const COMMAND_WORDS: readonly string[] = [
  "hapus", "ubah", "sesuaikan", "betulkan", "undo", "redo", "ulangi", "batalkan", "batal",
  "alias", "pin", "backup", "reset", "akun", "kategori", "saldo", "transfer",
  "anggaran", "berulang", "utang", "piutang", "hutang", "bayar", "laporan",
  "ringkasan", "report", "grafik", "chart", "dashboard", "csv", "export",
  "cari", "lihat", "riwayat", "history", "list", "ai", "versi", "version",
  "help", "bantuan", "cls", "clear", "bersihkan",
];

export const COMMAND_WORD_SET: ReadonlySet<string> = new Set(COMMAND_WORDS);

const CMD_RE = new RegExp(`^\\s*(?:${COMMAND_WORDS.join("|")})\\b`, "i");

// Apakah teks diawali kata perintah (bukan transaksi biasa)?
export function startsWithCommand(text: string): boolean {
  return CMD_RE.test(text);
}
