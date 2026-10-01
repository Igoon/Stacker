export interface CatAgg {
  kategori: string;
  total: number;
}

export interface GrafikInput {
  label: string;
  masuk: number;
  keluar: number;
  keluarCats: CatAgg[];
  masukCats: CatAgg[];
  daily: { tanggal: string; keluar: number }[];
  transfer?: { masuk: number; keluar: number };
  saldoLines?: string[];
  barWidth?: number;
  maxCats?: number;
}

const SPARK = "▁▂▃▄▅▆▇█";

export function shortRp(n: number): string {
  const a = Math.abs(n);
  const one = (x: number) => {
    const v = Math.round(x * 10) / 10;
    return (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ","));
  };
  if (a >= 1e9) return one(a / 1e9) + "M";
  if (a >= 1e6) return one(a / 1e6) + "jt";
  if (a >= 1e3) return one(a / 1e3) + "rb";
  return String(Math.round(a));
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const d = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  let guard = 0;
  while (d <= end && guard < 400) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
    d.setDate(d.getDate() + 1);
    guard += 1;
  }
  return out;
}

function bar(value: number, max: number, width: number): string {
  if (max <= 0) return "░".repeat(width);
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function catSection(title: string, cats: CatAgg[], barWidth: number, maxCats: number): string[] {
  if (cats.length === 0) return [];
  const sorted = [...cats].sort((a, b) => b.total - a.total);
  const total = sorted.reduce((a, c) => a + c.total, 0);
  const top = sorted.slice(0, maxCats);
  const restSum = sorted.slice(maxCats).reduce((a, c) => a + c.total, 0);
  if (restSum > 0) top.push({ kategori: "Lainnya", total: restSum });

  const max = Math.max(...top.map((c) => c.total), 1);
  const labelW = Math.min(12, Math.max(...top.map((c) => c.kategori.length)));
  const lines = [`${title}  ${shortRp(total)}`];
  for (const c of top) {
    const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
    const name = c.kategori.length > labelW ? c.kategori.slice(0, labelW) : c.kategori.padEnd(labelW);
    lines.push(`${name}  ${bar(c.total, max, barWidth)} ${shortRp(c.total)} ${pct}%`);
  }
  return lines;
}

function sparkLine(daily: { tanggal: string; keluar: number }[]): string[] {
  if (daily.length === 0) return [];
  const values = daily.map((d) => d.keluar);
  const max = Math.max(...values, 1);
  const chars = values.map((v) => SPARK[Math.min(7, v <= 0 ? 0 : Math.ceil((v / max) * 7))]);
  const lines: string[] = [];
  const perRow = 7;
  for (let i = 0; i < chars.length; i += perRow) {
    const slice = chars.slice(i, i + perRow);
    const d0 = daily[i]?.tanggal ?? "";
    const d1 = daily[Math.min(i + perRow - 1, daily.length - 1)]?.tanggal ?? "";
    const lab = `${d0.slice(8, 10)}-${d1.slice(8, 10)}`;
    lines.push(`${lab.padEnd(6)} ${slice.join("")}`);
  }
  const peakIdx = values.indexOf(Math.max(...values));
  const peak = daily[peakIdx];
  if (peak && peak.keluar > 0) {
    lines.push(`puncak ${peak.tanggal.slice(8, 10)}/${peak.tanggal.slice(5, 7)} ${shortRp(peak.keluar)}`);
  }
  return lines;
}

export function buildGrafik(g: GrafikInput): string {
  const barWidth = g.barWidth ?? 12;
  const maxCats = g.maxCats ?? 8;
  const out: string[] = [];

  out.push(`📊 ${g.label}`);
  out.push("");
  out.push(`Masuk   ${shortRp(g.masuk)}`);
  out.push(`Keluar  ${shortRp(g.keluar)}`);
  const sisa = g.masuk - g.keluar;
  out.push(`Sisa   ${sisa < 0 ? "-" : "+"}${shortRp(sisa)}`);
  out.push("");

  if (g.transfer && (g.transfer.masuk > 0 || g.transfer.keluar > 0)) {
    out.push(`Transfer  keluar ${shortRp(g.transfer.keluar)} · masuk ${shortRp(g.transfer.masuk)}`);
    out.push("");
  }

  const kel = catSection("Keluar per kategori", g.keluarCats, barWidth, maxCats);
  if (kel.length) {
    out.push(...kel);
    out.push("");
  }
  const mas = catSection("Masuk per kategori", g.masukCats, barWidth, maxCats);
  if (mas.length) {
    out.push(...mas);
    out.push("");
  }

  const spark = sparkLine(g.daily);
  if (spark.length) {
    out.push("Tren keluar harian");
    out.push(...spark);
  }

  if (g.saldoLines && g.saldoLines.length) {
    out.push("");
    out.push("Saldo: " + g.saldoLines.join(" · "));
  }

  return out.join("\n").trimEnd();
}

export const buildDailyRange = daysBetween;