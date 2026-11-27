// bot/analytics.ts — kalkulasi anggaran, alokasi 50/30/20, skor kesehatan, & data dashboard.
import {
  accountBalances,
  activeDaysSince,
  debtTotals,
  getBudget,
  getSetting,
  listBudgets,
  listCategories,
  ringkasRange,
  rupiah,
  saldo,
  searchTx,
  type Budget,
  type Tx,
} from "../db";
import { isoLocal, lastMonths, parsePeriod, previousMonthPeriod, previousPeriod, type Period } from "../dates";
import { buildDonutSvg, buildTrendSvg } from "../chart";

export function budgetWindow(b: Budget): Period | null {
  return b.periode === "mingguan" ? parsePeriod("minggu ini") : parsePeriod("");
}

export function spentIn(kategori: string, per: Period): number {
  const k = kategori.toLowerCase();
  return ringkasRange(per.from, per.to)
    .filter((r) => r.tipe === "keluar" && r.kategori.toLowerCase() === k)
    .reduce((a, b) => a + b.total, 0);
}

// Carry = sisa periode lalu (bisa negatif). Hanya dipakai bila rollover aktif.
export function budgetCarry(b: Budget): number {
  if (!b.rollover) return 0;
  const cur = budgetWindow(b);
  if (!cur) return 0;
  const prev = b.periode === "mingguan" ? previousPeriod(cur) : previousMonthPeriod(cur);
  return b.jumlah - spentIn(b.kategori, prev);
}

export function budgetEffective(b: Budget): number {
  return Math.max(0, b.jumlah + budgetCarry(b));
}

export interface BudgetRow {
  kategori: string;
  jumlah: number;
  periode: string;
  rollover: boolean;
  spent: number;
  effective: number;
  carry: number;
  pct: number;
}

// Data anggaran terstruktur untuk UI (dipakai worker).
export function budgetOverview(): BudgetRow[] {
  return listBudgets()
    .map((b) => {
      const w = budgetWindow(b);
      const spent = w ? spentIn(b.kategori, w) : 0;
      const carry = budgetCarry(b);
      const effective = Math.max(0, b.jumlah + carry);
      const pct = effective > 0 ? Math.round((spent / effective) * 100) : 0;
      return {
        kategori: b.kategori,
        jumlah: b.jumlah,
        periode: b.periode,
        rollover: !!b.rollover,
        spent,
        effective,
        carry,
        pct,
      };
    })
    .sort((a, b) => a.kategori.localeCompare(b.kategori));
}

// Ringkasan dashboard (bulan berjalan) untuk UI.
const ALLOC_NEEDS = new Set([
  "makanan", "transportasi", "transport", "tagihan", "kesehatan",
  "pendidikan", "rumah", "tempat tinggal", "asuransi", "kebutuhan",
]);
const ALLOC_SAVINGS = new Set([
  "tabungan", "investasi", "dana darurat", "sedekah", "donasi", "saving", "savings",
]);

export interface Alloc {
  income: number;
  needs: number;
  wants: number;
  savings: number;
  unallocated: number;
  targetNeeds: number;
  targetWants: number;
  targetSavings: number;
}

function buildGroupMap(): Map<string, "needs" | "wants" | "savings"> {
  const map = new Map<string, "needs" | "wants" | "savings">();
  for (const c of listCategories()) {
    if (c.kelompok === "kebutuhan") map.set(c.nama.toLowerCase().trim(), "needs");
    else if (c.kelompok === "keinginan") map.set(c.nama.toLowerCase().trim(), "wants");
    else if (c.kelompok === "tabungan") map.set(c.nama.toLowerCase().trim(), "savings");
  }
  return map;
}

// Klasifikasi kategori ke kelompok 50/30/20: prioritaskan kolom `kelompok` di DB,
// lalu fallback ke heuristik nama kategori umum bila belum diatur.
function catGroup(
  nama: string,
  groupMap?: Map<string, "needs" | "wants" | "savings">
): "needs" | "wants" | "savings" {
  const n = nama.toLowerCase().trim();
  const explicit = groupMap?.get(n);
  if (explicit) return explicit;
  if (ALLOC_SAVINGS.has(n)) return "savings";
  if (ALLOC_NEEDS.has(n)) return "needs";
  return "wants";
}

// Panduan 50/30/20 dari pemasukan bulan berjalan (transfer dikecualikan).
// `savings` = tabungan/investasi yang benar-benar tercatat; `unallocated` = sisa pemasukan.
export function computeAlloc(periodArg = ""): Alloc {
  const per = parsePeriod(periodArg) ?? parsePeriod("");
  const rows = per ? ringkasRange(per.from, per.to) : [];
  const groupMap = buildGroupMap();
  const income = rows.filter((r) => r.tipe === "masuk").reduce((a, b) => a + b.total, 0);
  let needs = 0;
  let wants = 0;
  let savings = 0;
  for (const r of rows) {
    if (r.tipe !== "keluar") continue;
    const g = catGroup(r.kategori, groupMap);
    if (g === "needs") needs += r.total;
    else if (g === "savings") savings += r.total;
    else wants += r.total;
  }
  const unallocated = income - needs - wants - savings;
  return {
    income,
    needs,
    wants,
    savings,
    unallocated,
    targetNeeds: Math.round(income * 0.5),
    targetWants: Math.round(income * 0.3),
    targetSavings: Math.round(income * 0.2),
  };
}

export interface HealthFactor {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}
export interface Health {
  score: number;
  tier: string;
  factors: HealthFactor[];
  tip: string;
}

// Skor kesehatan finansial 0-100 (rule-based, lokal, tanpa AI).
export function computeHealth(): Health {
  const per = parsePeriod("");
  const rows = per ? ringkasRange(per.from, per.to) : [];
  const groupMap = buildGroupMap();
  const income = rows.filter((r) => r.tipe === "masuk").reduce((a, b) => a + b.total, 0);
  // Pengeluaran hidup: kecualikan kategori tabungan/investasi agar menabung tidak menurunkan skor.
  const livingExpenses = rows
    .filter((r) => r.tipe === "keluar" && catGroup(r.kategori, groupMap) !== "savings")
    .reduce((a, b) => a + b.total, 0);
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  // 1) Rasio tabungan (target >= 30%).
  const rate = income > 0 ? (income - livingExpenses) / income : 0;
  const savingsScore = income > 0 ? clamp((rate / 0.3) * 100) : 50;
  const savingsDetail = income > 0 ? `${Math.round(rate * 100)}% dari pemasukan` : "belum ada pemasukan";

  // 2) Kepatuhan anggaran.
  const budgets = budgetOverview();
  const inBudget = budgets.filter((b) => b.pct <= 100).length;
  const budgetScore = budgets.length ? clamp((inBudget / budgets.length) * 100) : 60;
  const budgetDetail = budgets.length ? `${inBudget}/${budgets.length} kategori dalam batas` : "belum ada anggaran";

  // 3) Beban utang (debt-to-income).
  const { utang } = debtTotals();
  const dti = income > 0 ? utang / income : utang > 0 ? 1 : 0;
  const debtScore = clamp((1 - dti) * 100);
  const debtDetail = utang > 0 ? `utang ${rupiah(utang)}` : "tanpa utang";

  // 4) Dana darurat (dalam bulan biaya: rata-rata hingga 3 bulan selesai terakhir).
  const past3 = lastMonths(4).slice(0, 3);
  const pastExp = past3
    .map((p) =>
      ringkasRange(p.from, p.to)
        .filter((r) => r.tipe === "keluar" && catGroup(r.kategori, groupMap) !== "savings")
        .reduce((a, b) => a + b.total, 0)
    )
    .filter((x) => x > 0);
  const baseExpense =
    pastExp.length > 0
      ? pastExp.reduce((a, b) => a + b, 0) / pastExp.length
      : livingExpenses;
  const saldoNow = saldo();
  const hasBase = baseExpense > 0;
  const months = hasBase ? saldoNow / baseExpense : 0;
  const bufferScore = hasBase ? clamp((months / 3) * 100) : saldoNow > 0 ? 50 : 0;
  const bufferDetail = hasBase ? `${months.toFixed(1)}× biaya bulanan` : "belum ada data biaya";

  // 5) Konsistensi mencatat (memperhitungkan tanggal pertama pakai untuk pengguna baru).
  const firstUse = getSetting("first_use_at");
  let windowDays = 30;
  if (firstUse) {
    const t0 = new Date(firstUse).getTime();
    if (Number.isFinite(t0)) {
      const elapsed = Math.floor((Date.now() - t0) / 86_400_000) + 1;
      if (elapsed > 0 && elapsed < 30) windowDays = elapsed;
    }
  }
  const from = isoLocal(new Date(Date.now() - (windowDays - 1) * 86_400_000));
  const days = activeDaysSince(from);
  const consistencyScore = clamp((days / windowDays) * 100);
  const consistencyDetail = `${days} hari aktif/${windowDays}`;

  const factors: HealthFactor[] = [
    { key: "savings", label: "Rasio tabungan", score: savingsScore, weight: 30, detail: savingsDetail },
    { key: "budget", label: "Kepatuhan anggaran", score: budgetScore, weight: 20, detail: budgetDetail },
    { key: "debt", label: "Beban utang", score: debtScore, weight: 20, detail: debtDetail },
    { key: "buffer", label: "Dana darurat", score: bufferScore, weight: 15, detail: bufferDetail },
    { key: "consistency", label: "Konsistensi mencatat", score: consistencyScore, weight: 15, detail: consistencyDetail },
  ];
  const score = Math.round(factors.reduce((a, f) => a + f.score * f.weight, 0) / 100);
  const tier = score >= 80 ? "Sehat" : score >= 60 ? "Baik" : score >= 40 ? "Cukup" : "Perlu perhatian";
  const tipFor: Record<string, string> = {
    savings: "Tingkatkan rasio tabungan (target ≥30% dari pemasukan).",
    budget: "Jaga kategori tetap di bawah batas anggaran.",
    debt: "Kurangi atau lunasi utang untuk menurunkan beban.",
    buffer: "Kumpulkan dana darurat (idealnya 3× biaya bulanan).",
    consistency: "Catat transaksi tiap hari agar konsisten.",
  };
  const worst = [...factors].sort(
    (a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score)
  )[0];
  return { score, tier, factors, tip: tipFor[worst.key] ?? "" };
}

export function dashboardData(periodArg = ""): {
  ym: string;
  label: string;
  masuk: number;
  keluar: number;
  net: number;
  totalSaldo: number;
  netWorth: number;
  utang: number;
  piutang: number;
  projNet: number;
  avg3Net: number;
  top: { kategori: string; total: number }[];
  accounts: { nama: string; saldo: number }[];
  today: { keluar: number; masuk: number; count: number };
  trend: { label: string; masuk: number; keluar: number }[];
  svg: string;
  trendSvg: string;
  alloc: Alloc;
  health: Health;
} {
  const per = parsePeriod(periodArg) ?? parsePeriod("");
  const ym = per?.from.slice(0, 7) ?? isoLocal().slice(0, 7);
  const label = per?.label ?? "bulan ini";
  const rows = per ? ringkasRange(per.from, per.to) : [];
  const keluarCats = rows
    .filter((r) => r.tipe === "keluar")
    .map((r) => ({ kategori: r.kategori, total: r.total }));
  const masukCats = rows
    .filter((r) => r.tipe === "masuk")
    .map((r) => ({ kategori: r.kategori, total: r.total }));
  const masuk = masukCats.reduce((a, c) => a + c.total, 0);
  const keluar = keluarCats.reduce((a, c) => a + c.total, 0);
  const top = [...keluarCats].sort((a, b) => b.total - a.total).slice(0, 5);
  const svg = keluarCats.length ? buildDonutSvg(keluarCats, { maxCats: 5, centerLabel: "keluar" }) : "";
  const accounts = accountBalances()
    .filter((a) => (a.saldo ?? 0) !== 0)
    .map((a) => ({ nama: a.nama, saldo: a.saldo ?? 0 }));
  const tFrom = parsePeriod("hari ini")?.from ?? "";
  const txsToday = tFrom
    ? searchTx("", { from: tFrom, to: tFrom, limit: 500 }).filter((t) => !t.transfer_id)
    : [];
  const today = {
    keluar: txsToday.filter((t) => t.tipe === "keluar").reduce((a, t) => a + t.jumlah, 0),
    masuk: txsToday.filter((t) => t.tipe === "masuk").reduce((a, t) => a + t.jumlah, 0),
    count: txsToday.length,
  };

  // Net worth = aset (saldo akun + piutang) − utang.
  const { utang, piutang } = debtTotals();
  const totalSaldo = saldo();
  const netWorth = totalSaldo + piutang - utang;

  // Tren 6 bulan + rata-rata net 3 bulan.
  const monthNet = (p: Period): { label: string; masuk: number; keluar: number } => {
    const rr = ringkasRange(p.from, p.to);
    return {
      label: p.label.slice(0, 3),
      masuk: rr.filter((x) => x.tipe === "masuk").reduce((a, b) => a + b.total, 0),
      keluar: rr.filter((x) => x.tipe === "keluar").reduce((a, b) => a + b.total, 0),
    };
  };
  const trend = lastMonths(6).map(monthNet);
  const trendSvg = trend.length ? buildTrendSvg(trend) : "";
  // Rata-rata net 3 bulan selesai terakhir (kecualikan bulan berjalan agar tidak bias).
  const nets = lastMonths(4)
    .slice(0, 3)
    .map((p) => {
      const m = monthNet(p);
      return m.masuk - m.keluar;
    });
  const avg3Net = nets.length ? Math.round(nets.reduce((a, b) => a + b, 0) / nets.length) : 0;

  // Proyeksi net hanya untuk bulan berjalan (mulai hari ke-3 agar tidak melonjak 30x di tgl 1).
  const iso = isoLocal();
  const curYm = iso.slice(0, 7);
  const dayN = Number(iso.slice(8, 10)) || 1;
  const dim = per ? Number(per.to.slice(8, 10)) || 31 : 31;
  const projNet =
    ym === curYm && dayN >= 3
      ? Math.round(((masuk - keluar) / dayN) * dim)
      : masuk - keluar;

  return {
    ym,
    label,
    masuk,
    keluar,
    net: masuk - keluar,
    totalSaldo,
    netWorth,
    utang,
    piutang,
    projNet,
    avg3Net,
    top,
    accounts,
    today,
    trend,
    svg,
    trendSvg,
    alloc: computeAlloc(periodArg),
    health: computeHealth(),
  };
}

export function budgetWarn(t: Tx): string | null {
  if (t.tipe !== "keluar") return null;
  const b = getBudget(t.kategori);
  if (!b) return null;
  const carry = budgetCarry(b);
  const limit = Math.max(0, b.jumlah + carry);
  if (limit <= 0) return null;
  const cur = budgetWindow(b);
  if (!cur) return null;
  const spent = spentIn(b.kategori, cur);
  const prev = spent - t.jumlah;
  const per = b.periode === "mingguan" ? "minggu ini" : "bulan ini";
  const carryNote = carry !== 0 ? ` (limit ${rupiah(limit)}, carry ${carry > 0 ? "+" : "-"}${rupiah(Math.abs(carry))})` : "";
  if (prev < limit && spent >= limit) {
    return `⚠️ Anggaran ${t.kategori} tembus ${per}: ${rupiah(spent)} / ${rupiah(limit)}${carryNote}`;
  }
  if (prev < limit * 0.8 && spent >= limit * 0.8) {
    return `⚠️ Anggaran ${t.kategori} ${Math.floor((spent / limit) * 100)}% ${per}: ${rupiah(spent)} / ${rupiah(limit)}${carryNote}`;
  }
  return null;
}

