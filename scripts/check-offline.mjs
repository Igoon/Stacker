// Uji offline build produksi: load pertama -> SW aktif -> offline -> reload
// harus tetap membuka app (aset sudah di-precache).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4173;
const base = `http://localhost:${port}/`;
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");

const server = spawn(process.execPath, [viteBin, "preview", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
});

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {
      // belum siap
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("preview server tidak siap");
}

let browser;
try {
  await waitServer();
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ channel: "chrome" });
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(
    () => /^v\d/.test(document.querySelector("#sub")?.textContent ?? ""),
    null,
    { timeout: 60_000 }
  );
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
    timeout: 30_000,
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => /^v\d/.test(document.querySelector("#sub")?.textContent ?? ""),
    null,
    { timeout: 20_000 }
  );
  console.log("offline OK: app terbuka tanpa jaringan");
} finally {
  if (browser) await browser.close();
  server.kill();
}
