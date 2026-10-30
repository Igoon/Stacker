// Isi PRECACHE service worker dengan SEMUA aset hasil build (JS/CSS/WASM/ikon)
// supaya app bisa dibuka offline walaupun baru pertama kali dipasang.
// Dijalankan otomatis setelah `vite build`.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const swSrc = join(root, "public", "sw.js");
const swOut = join(dist, "sw.js");

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = (await walk(dist))
  .map((f) => relative(dist, f).split(sep).join("/"))
  .filter((f) => f !== "sw.js" && !f.endsWith(".map"))
  .sort();

const urls = files.map((f) => (f === "index.html" ? "./" : "./" + f));
const digest = createHash("sha256");
for (const f of files) {
  digest.update(f);
  digest.update(await readFile(join(dist, f)));
}
const hash = digest.digest("hex").slice(0, 8);

let sw = await readFile(swSrc, "utf8");
sw = sw.replace(
  /\/\/ CACHE-BEGIN[\s\S]*?\/\/ CACHE-END/,
  `// CACHE-BEGIN\nconst CACHE = "stacker-${hash}";\n// CACHE-END`
);
sw = sw.replace(
  /\/\/ PRECACHE-BEGIN[\s\S]*?\/\/ PRECACHE-END/,
  `// PRECACHE-BEGIN\nconst PRECACHE = ${JSON.stringify(urls, null, 2)};\n// PRECACHE-END`
);

const html = await readFile(join(dist, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
const missing = refs.filter((r) => r !== "./" && !urls.includes(r));
if (missing.length) throw new Error(`aset di index.html tidak masuk precache: ${missing.join(", ")}`);

await writeFile(swOut, sw, "utf8");
console.log(`sw.js: precache ${urls.length} aset (cache stacker-${hash})`);
