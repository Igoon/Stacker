// Korpus uji parser: kalimat nyata + ekspektasi. Dipakai `smoke.ts` supaya
// perubahan parser tak diam-diam merusak kasus yang sering dipakai.
export interface ParserCase {
  input: string;
  tipe: "masuk" | "keluar";
  kategori: string;
  jumlah: number;
  confidence: "high" | "low";
  tanggal?: string;
}

export const PARSER_CASES: ParserCase[] = [
  { input: "makan siang 50rb", tipe: "keluar", kategori: "Makanan", jumlah: 50_000, confidence: "high" },
  { input: "gaji 5jt", tipe: "masuk", kategori: "Gaji", jumlah: 5_000_000, confidence: "high" },
  { input: "bensin 100rb", tipe: "keluar", kategori: "Transportasi", jumlah: 100_000, confidence: "high" },
  { input: "bayar listrik 350rb", tipe: "keluar", kategori: "Tagihan", jumlah: 350_000, confidence: "high" },
  { input: "obat batuk 45rb", tipe: "keluar", kategori: "Kesehatan", jumlah: 45_000, confidence: "high" },
  { input: "nonton bioskop 60rb", tipe: "keluar", kategori: "Hiburan", jumlah: 60_000, confidence: "high" },
  { input: "beli sepatu 300rb", tipe: "keluar", kategori: "Belanja", jumlah: 300_000, confidence: "high" },
  { input: "honor 2jt", tipe: "masuk", kategori: "Gaji", jumlah: 2_000_000, confidence: "high" },
  { input: "parkir 5rb", tipe: "keluar", kategori: "Transportasi", jumlah: 5_000, confidence: "high" },
  { input: "makan lima ribu", tipe: "keluar", kategori: "Makanan", jumlah: 5_000, confidence: "high" },
  { input: "dua juta", tipe: "keluar", kategori: "Lainnya", jumlah: 2_000_000, confidence: "low" },
  { input: "masuk 100rb", tipe: "masuk", kategori: "Lainnya", jumlah: 100_000, confidence: "high" },
  { input: "pengeluaran 25rb", tipe: "keluar", kategori: "Lainnya", jumlah: 25_000, confidence: "high" },
  { input: "gojex 8rb", tipe: "keluar", kategori: "Transportasi", jumlah: 8_000, confidence: "high" },
  { input: "servis motor 150rb", tipe: "keluar", kategori: "Lainnya", jumlah: 150_000, confidence: "low" },
  { input: "1,5jt", tipe: "keluar", kategori: "Lainnya", jumlah: 1_500_000, confidence: "low" },
  { input: "45.001.889", tipe: "keluar", kategori: "Lainnya", jumlah: 45_001_889, confidence: "low" },
  { input: "2026-09-03 jajan 20rb", tipe: "keluar", kategori: "Makanan", jumlah: 20_000, confidence: "high", tanggal: "2026-09-03" },
  { input: "kopi 18rb sama makan 20rb", tipe: "keluar", kategori: "Makanan", jumlah: 18_000, confidence: "low" },
  { input: "bayar air 90rb", tipe: "keluar", kategori: "Tagihan", jumlah: 90_000, confidence: "high" },
];
