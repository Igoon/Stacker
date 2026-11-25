// ui/icons.ts — SVG ikon kategori untuk kartu transaksi & manajemen kategori.
const CAT_ICON_SVG: Record<string, string> = {
  makanan:
    '<path d="M5 3v6a2 2 0 0 0 4 0V3"/><path d="M7 3v18"/><path d="M18 3c-1.7 0-3 2.2-3 5s1.3 4 3 4 3-1 3-4-1.3-5-3-5z"/><path d="M18 12v9"/>',
  transportasi:
    '<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M4 10h16"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/>',
  belanja: '<path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  tagihan: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/>',
  kesehatan: '<path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.5-7 9-7 9z"/>',
  hiburan: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  gaji: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14" r="1"/>',
  tabungan: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  investasi: '<path d="M4 20V12"/><path d="M10 20V6"/><path d="M16 20v-6"/><path d="M2 20h20"/>',
  transfer:
    '<path d="M4 8h13"/><path d="M13 4l4 4-4 4"/><path d="M20 16H7"/><path d="M11 12l-4 4 4 4"/>',
};

const CAT_ICON_DEFAULT =
  '<path d="M20.6 12.6 12.6 20.6a2 2 0 0 1-2.8 0l-6.4-6.4A2 2 0 0 1 3 12.8V5a2 2 0 0 1 2-2h7.8a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.6z"/><circle cx="7.5" cy="7.5" r="1.2"/>';

export const ICON_OPTIONS: [string, string][] = [
  ["makanan", "Makanan"],
  ["transportasi", "Transportasi"],
  ["belanja", "Belanja"],
  ["tagihan", "Tagihan"],
  ["kesehatan", "Kesehatan"],
  ["hiburan", "Hiburan"],
  ["gaji", "Gaji"],
  ["tabungan", "Tabungan"],
  ["investasi", "Investasi"],
  ["transfer", "Transfer"],
  ["tag", "Lainnya"],
];

export function catIconSvg(name: string, iconId?: string): string {
  let inner: string | undefined;
  const id = iconId?.toLowerCase().trim();
  if (id === "tag") inner = CAT_ICON_DEFAULT;
  else if (id) inner = CAT_ICON_SVG[id];
  if (!inner) inner = CAT_ICON_SVG[name.toLowerCase().trim()];
  if (!inner) inner = CAT_ICON_DEFAULT;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
