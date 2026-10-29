// gen-icons.mjs — hasilkan ikon PNG dari SVG (butuh sharp). Jalankan: npm run icons
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

async function png(svg, out, size) {
  await sharp(path.join(pub, svg)).resize(size, size).png().toFile(path.join(pub, out));
  console.log("  " + out);
}

console.log("generate ikon...");
await png("icon.svg", "icon-192.png", 192);
await png("icon.svg", "icon-512.png", 512);
await png("icon.svg", "apple-touch-icon.png", 180);
await png("icon-maskable.svg", "icon-maskable-192.png", 192);
await png("icon-maskable.svg", "icon-maskable-512.png", 512);
console.log("selesai");
