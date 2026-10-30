const BULAN = [
  "januari", "februari", "maret", "april", "mei", "juni",
  "juli", "agustus", "september", "oktober", "november", "desember",
];

const BULAN_MAP: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, agt: 8, agustus: 8, ags: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  des: 12, desember: 12,
};

const MONTH_RE = Object.keys(BULAN_MAP).join("|");

const pad = (n: number) => String(n).padStart(2, "0");

export function isoLocal(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromParts(y: number, m: number, day: number): string | null {
  if (m < 1 || m > 12 || day < 1 || day > 31) return null;
  const d = new Date(y, m - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) return null;
  return isoLocal(d);
}

function shiftDays(day: number): string {
  const d = new Date();
  d.setDate(d.getDate() + day);
  return isoLocal(d);
}

export interface ExtractDate {
  tanggal?: string;
  cleaned: string;
}

export function extractDate(text: string): ExtractDate {
  let s = ` ${text} `;
  let tanggal: string | undefined;

  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const t = fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (t) return { tanggal: t, cleaned: s.replace(iso[0], " ").trim() };
  }

  if (/\bkemarin\b/i.test(s)) {
    tanggal = shiftDays(-1);
    s = s.replace(/\bkemarin\b/gi, " ");
  } else if (/\bhari ini\b/i.test(s)) {
    tanggal = shiftDays(0);
    s = s.replace(/\bhari ini\b/gi, " ");
  } else {
    const dm = s.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?\\b`, "i"));
    if (dm) {
      const now = new Date();
      const y = dm[3] ? Number(dm[3]) : now.getFullYear();
      const t = fromParts(y, BULAN_MAP[dm[2].toLowerCase()], Number(dm[1]));
      if (t) {
        tanggal = t;
        s = s.replace(dm[0], " ");
      }
    } else {
      const tm = s.match(/\b(?:tgl|tanggal)\s+(\d{1,2})\b/i);
      if (tm) {
        const now = new Date();
        const t = fromParts(now.getFullYear(), now.getMonth() + 1, Number(tm[1]));
        if (t) {
          tanggal = t;
          s = s.replace(tm[0], " ");
        }
      }
    }
  }

  return { tanggal, cleaned: s.trim() };
}

export interface Period {
  from: string;
  to: string;
  label: string;
}

function monthPeriod(y: number, m: number): Period {
  const from = fromParts(y, m, 1)!;
  const to = isoLocal(new Date(y, m, 0));
  return { from, to, label: `${BULAN[m - 1]} ${y}` };
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoLocal(new Date(y, m - 1, d + n));
}

// Jarak hari inklusif: 1–31 = 31.
export function dayCount(per: Period): number {
  return Math.round((Date.parse(per.to) - Date.parse(per.from)) / 86_400_000) + 1;
}

// Periode tepat sebelum `per` dengan panjang hari sama.
export function previousPeriod(per: Period): Period {
  const to = addDaysIso(per.from, -1);
  const from = addDaysIso(to, -(dayCount(per) - 1));
  return { from, to, label: "periode sebelumnya" };
}

// Bulan kalender tepat sebelum `per` (dipakai carry anggaran bulanan).
export function previousMonthPeriod(per: Period): Period {
  const [y, m] = per.from.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return monthPeriod(d.getFullYear(), d.getMonth() + 1);
}

// `n` bulan terakhir (termasuk bulan berjalan), urut lama → baru.
export function lastMonths(n: number, ref = new Date()): Period[] {
  const out: Period[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    out.push(monthPeriod(d.getFullYear(), d.getMonth() + 1));
  }
  return out;
}

export function parsePeriod(arg: string, ref = new Date()): Period | null {
  const a = arg.trim().toLowerCase();
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;

  if (a === "" || a === "bulan ini" || a === "bulan") return monthPeriod(y, m);

  if (a === "bulan lalu" || a === "bulan kemarin") {
    const d = new Date(y, m - 2, 1);
    return monthPeriod(d.getFullYear(), d.getMonth() + 1);
  }

  if (a === "tahun ini") return { from: fromParts(y, 1, 1)!, to: fromParts(y, 12, 31)!, label: `tahun ${y}` };
  if (a === "tahun lalu") return { from: fromParts(y - 1, 1, 1)!, to: fromParts(y - 1, 12, 31)!, label: `tahun ${y - 1}` };

  if (a === "hari ini") { const t = isoLocal(ref); return { from: t, to: t, label: "hari ini" }; }
  if (a === "kemarin") { const t = shiftDays(-1); return { from: t, to: t, label: "kemarin" }; }

  if (a === "minggu ini" || a === "pekan ini") {
    const d = new Date(ref);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    const from = isoLocal(d);
    const to = isoLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6));
    return { from, to, label: "minggu ini" };
  }
  if (a === "minggu lalu" || a === "pekan lalu") {
    const d = new Date(ref);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow - 7);
    const from = isoLocal(d);
    const to = isoLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6));
    return { from, to, label: "minggu lalu" };
  }

  const ym = a.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const yy = Number(ym[1]);
    const mm = Number(ym[2]);
    if (mm >= 1 && mm <= 12) return monthPeriod(yy, mm);
    return null;
  }

  const yOnly = a.match(/^(\d{4})$/);
  if (yOnly) {
    const yy = Number(yOnly[1]);
    return { from: fromParts(yy, 1, 1)!, to: fromParts(yy, 12, 31)!, label: `tahun ${yy}` };
  }

  const mn = a.match(new RegExp(`^(${MONTH_RE})(?:\\s+(\\d{4}))?$`, "i"));
  if (mn) {
    const mm = BULAN_MAP[mn[1].toLowerCase()];
    const yy = mn[2] ? Number(mn[2]) : y;
    return monthPeriod(yy, mm);
  }

  return null;
}
