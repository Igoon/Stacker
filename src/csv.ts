import { rupiah, type Tx } from "./db";

function cell(v: string | number | null): string {
  let s = String(v ?? "");
  // Cegah formula injection di spreadsheet: nilai teks yang diawali salah satu
  // karakter ini diberi prefix apostrof (ditampilkan sebagai teks biasa).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: Tx[]): string {
  const head = ["id", "tanggal", "tipe", "akun", "kategori", "jumlah", "catatan"];
  const lines = rows.map((t) =>
    [t.id, t.tanggal, t.tipe, t.akun ?? "", t.kategori, t.jumlah, t.catatan ?? ""].map(cell).join(",")
  );
  const total = rows.reduce((a, t) => a + (t.tipe === "masuk" ? t.jumlah : -t.jumlah), 0);
  lines.push(["", "", "", "", "selisih", total, rupiah(total)].map(cell).join(","));
  return [head.join(","), ...lines].join("\r\n");
}
