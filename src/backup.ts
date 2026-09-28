import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

const DIR = path.join(process.cwd(), "backups");
const KEEP = 14;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

function prune(): void {
  if (!fs.existsSync(DIR)) return;
  const files = fs
    .readdirSync(DIR)
    .filter((f) => /^data-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  while (files.length > KEEP) {
    const f = files.shift();
    if (f) fs.rmSync(path.join(DIR, f), { force: true });
  }
}

export async function runBackup(): Promise<string | null> {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(DIR, `data-${stamp}.db`);
  if (fs.existsSync(dest)) {
    prune();
    return null;
  }
  await db.backup(dest);
  prune();
  return dest;
}

export async function backupTagged(tag: string): Promise<string> {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(DIR, `${tag}-${stamp}.db`);
  await db.backup(dest);
  return dest;
}

let timer: NodeJS.Timeout | null = null;

export function startBackups(): void {
  runBackup()
    .then((p) => {
      if (p) console.log(`[backup] ${path.basename(p)}`);
    })
    .catch((e) => console.error("[backup] gagal:", (e as Error).message));

  if (!timer) {
    timer = setInterval(() => {
      runBackup().catch((e) => console.error("[backup] gagal:", (e as Error).message));
    }, INTERVAL_MS);
    timer.unref();
  }
}