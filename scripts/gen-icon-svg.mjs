// gen-icon-svg.mjs — bangun ikon dot-grid "S" (tersamar) dari pola, lalu tulis
// icon.svg + icon-maskable.svg. Jalankan lewat `npm run icons`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// 7x7. "1" = dot huruf S, "0" = dot latar (tersamar).
const PATTERN = [
  "0111110",
  "0110000",
  "0110000",
  "0111110",
  "0000110",
  "0000110",
  "0111110",
];

const BG = "#0b141a";
const ACCENT = "#00a884";
const DIM = "#14332b";

function svg({ pad, radius }) {
  const n = PATTERN.length;
  const span = 128 - pad * 2;
  const cell = span / n;
  const dot = cell * 0.62;
  const off = (cell - dot) / 2;
  const parts = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const on = PATTERN[r][c] === "1";
      const x = pad + c * cell + off;
      const y = pad + r * cell + off;
      parts.push(
        `  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${dot.toFixed(2)}" ` +
          `height="${dot.toFixed(2)}" rx="${(dot * 0.28).toFixed(2)}" fill="${on ? ACCENT : DIM}"/>`
      );
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n` +
    `  <rect width="128" height="128"${radius ? ` rx="${radius}"` : ""} fill="${BG}"/>\n` +
    parts.join("\n") +
    `\n</svg>\n`
  );
}

// `any`: full-bleed dengan sudut membulat. `maskable`: tanpa sudut, grid lebih
// kecil (safe zone 80%) supaya tak terpotong mask Android/iOS.
fs.writeFileSync(path.join(pub, "icon.svg"), svg({ pad: 16, radius: 24 }));
console.log("  icon.svg");
fs.writeFileSync(path.join(pub, "icon-maskable.svg"), svg({ pad: 26, radius: 0 }));
console.log("  icon-maskable.svg");
