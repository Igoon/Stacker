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

// ---------- Grafik SVG (inline, tanpa library & tanpa data keluar) ----------
const PALETTE = [
  "#00a884",
  "#53bdeb",
  "#f15c6d",
  "#ffbc3b",
  "#a78bfa",
  "#34d399",
  "#fb923c",
  "#e879f9",
];

const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DonutOpts {
  size?: number;
  stroke?: number;
  centerLabel?: string;
  maxCats?: number;
}

// Donut komposisi kategori. `cats` sudah berisi total per kategori.
export function buildDonutSvg(cats: CatAgg[], opts: DonutOpts = {}): string {
  const size = opts.size ?? 132;
  const stroke = opts.stroke ?? 22;
  const c = size / 2;
  const r = c - stroke / 2 - 2;
  const circ = 2 * Math.PI * r;
  const maxCats = opts.maxCats ?? 6;

  const sorted = [...cats].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, maxCats);
  const rest = sorted.slice(maxCats).reduce((a, x) => a + x.total, 0);
  if (rest > 0) top.push({ kategori: "Lainnya", total: rest });
  const total = top.reduce((a, x) => a + x.total, 0);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Komposisi kategori">`
  );
  parts.push(
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(134,150,160,.25)" stroke-width="${stroke}"/>`
  );
  let offset = 0;
  top.forEach((x, i) => {
    const frac = total > 0 ? x.total / total : 0;
    const len = frac * circ;
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${PALETTE[i % PALETTE.length]}"` +
        ` stroke-width="${stroke}" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(circ - Math.max(0, len - 2)).toFixed(2)}"` +
        ` stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
    );
    offset += len;
  });
  if (total > 0) {
    parts.push(
      `<text x="${c}" y="${c - 4}" text-anchor="middle" font-size="${Math.round(size * 0.13)}" font-weight="700" fill="currentColor">${escXml(shortRp(total))}</text>`
    );
    parts.push(
      `<text x="${c}" y="${c + Math.round(size * 0.09)}" text-anchor="middle" font-size="${Math.round(size * 0.082)}" fill="currentColor" opacity=".7">${escXml(opts.centerLabel ?? "total")}</text>`
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

export interface TrendMonth {
  label: string;
  masuk: number;
  keluar: number;
}

// Bar chart tren beberapa bulan: hijau = masuk, merah = keluar.
export function buildTrendSvg(months: TrendMonth[]): string {
  const W = 340;
  const H = 180;
  const padL = 42;
  const padR = 10;
  const padT = 14;
  const padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxRaw = Math.max(1, ...months.flatMap((m) => [m.masuk, m.keluar]));
  const step = Math.pow(10, Math.floor(Math.log10(maxRaw)));
  const max = Math.ceil(maxRaw / step) * step;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tren masuk dan keluar">`,
  ];

  for (let i = 0; i <= 2; i++) {
    const val = (max / 2) * i;
    const y = padT + plotH - (val / max) * plotH;
    parts.push(
      `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(134,150,160,.22)" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="currentColor" opacity=".65">${escXml(shortRp(val))}</text>`
    );
  }

  const slot = plotW / Math.max(months.length, 1);
  const bw = Math.min(13, slot * 0.32);
  months.forEach((m, i) => {
    const cx = padL + slot * i + slot / 2;
    const hMasuk = (m.masuk / max) * plotH;
    const hKeluar = (m.keluar / max) * plotH;
    const x1 = cx - bw - 1.5;
    const x2 = cx + 1.5;
    parts.push(
      `<rect x="${x1.toFixed(1)}" y="${(padT + plotH - hMasuk).toFixed(1)}" width="${bw.toFixed(1)}" height="${hMasuk.toFixed(1)}" rx="2" fill="${PALETTE[0]}"/>`
    );
    parts.push(
      `<rect x="${x2.toFixed(1)}" y="${(padT + plotH - hKeluar).toFixed(1)}" width="${bw.toFixed(1)}" height="${hKeluar.toFixed(1)}" rx="2" fill="${PALETTE[2]}"/>`
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".75">${escXml(m.label)}</text>`
    );
  });

  parts.push(
    `<g font-size="9" fill="currentColor" opacity=".8">` +
      `<rect x="${padL}" y="${H - 30}" width="7" height="7" rx="1.5" fill="${PALETTE[0]}"/>` +
      `<text x="${padL + 11}" y="${H - 23}">masuk</text>` +
      `<rect x="${padL + 55}" y="${H - 30}" width="7" height="7" rx="1.5" fill="${PALETTE[2]}"/>` +
      `<text x="${padL + 66}" y="${H - 23}">keluar</text>` +
      `</g>`
  );
  parts.push("</svg>");
  return parts.join("");
}