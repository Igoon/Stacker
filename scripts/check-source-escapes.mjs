// Penjaga integritas sumber: deteksi karakter kontrol yang bocor ke kode.
//
// Kasus nyata: zip yang dibuat ulang kadang meng-*interpret* escape sehingga
// "\n", "\t", "\r" di dalam string/regex tersimpan sebagai karakter kontrol
// literal. Baris baru literal di dalam string sudah pasti ditolak `tsc`,
// sedangkan TAB/CR bisa lolos tanpa error typecheck namun mengubah perilaku
// regex/CSV. Skrip ini khusus menolak TAB dan CR (repo ini hanya memakai spasi
// dan LF), sehingga tidak menghasilkan positif palsu.
//
// Jalankan: node scripts/check-source-escapes.mjs
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const targets = ["src", "scripts", "public", "e2e"];
const rootFiles = [
  "index.html",
  "vite.config.ts",
  "playwright.config.ts",
  "tsconfig.json",
  "package.json",
  "README.md",
  "CHANGELOG.md",
];
const ext = /\.(ts|mjs|js|css|html|json|md)$/;
const skip = new Set(["node_modules", "dist", ".git", "test-results", "assets"]);

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full)));
    else if (ext.test(ent.name)) out.push(full);
  }
  return out;
}

function controlHits(text) {
  const tabs = [];
  const crs = [];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) line++;
    else if (c === 9) tabs.push(line);
    else if (c === 13) {
      crs.push(line);
      if (text.charCodeAt(i + 1) === 10) i++;
    }
  }
  return { tabs, crs };
}

const files = [];
for (const dir of targets) {
  try {
    files.push(...(await walk(join(root, dir))));
  } catch {
    // folder opsional boleh tidak ada
  }
}
for (const f of rootFiles) {
  try {
    await readFile(join(root, f), "utf8");
    files.push(join(root, f));
  } catch {
    // lewati bila tidak ada
  }
}

const problems = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  const rel = relative(root, file).split(sep).join("/");
  const { tabs, crs } = controlHits(text);
  for (const l of tabs) problems.push(`${rel}:${l} TAB literal (kemungkinan "\\t" ter-escape)`);
  for (const l of crs) problems.push(`${rel}:${l} CR literal (kemungkinan "\\r" ter-escape)`);
}

if (problems.length) {
  console.error("Sumber mengandung karakter kontrol hasil escape yang salah:");
  for (const p of problems.slice(0, 50)) console.error("  - " + p);
  if (problems.length > 50) console.error(`  ... ${problems.length - 50} lainnya`);
  process.exit(1);
}

console.log(`check-source-escapes: ${files.length} file bersih (tanpa TAB/CR literal)`);
