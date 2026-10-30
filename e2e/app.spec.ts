import { expect, test, type Page } from "@playwright/test";

// Tiap tes dapat context baru => OPFS bersih, jadi urutan tak saling ganggu.

async function boot(page: Page): Promise<void> {
  // Web Share API dimatikan supaya ekspor selalu jatuh ke unduhan biasa
  // (deterministik di headless).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
  });
  await page.goto("/");
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
}

async function chat(page: Page, text: string): Promise<void> {
  const input = page.locator("#input");
  await input.fill(text);
  await input.press("Enter");
}

test("catat transaksi, saldo akurat, undo mengembalikan", async ({ page }) => {
  await boot(page);

  await chat(page, "makan siang 50rb");
  await expect(page.locator("#chat .tx").last()).toContainText("Makanan");
  await expect(page.locator("#saldo")).toHaveText(/-Rp50\.000/);

  await chat(page, "undo");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Dibatalkan" })).toBeVisible();
  await expect(page.locator("#saldo")).toHaveText(/Rp0/);

  // Data benar-benar hilang: reload => hint transaksi tak muncul.
  await page.reload();
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#chat .bubble").filter({ hasText: "transaksi tersimpan" })).toHaveCount(0);
});

test("grafik SVG & laporan banding tampil di chat", async ({ page }) => {
  await boot(page);
  await chat(page, "makan 50rb");
  await chat(page, "grafik komposisi");

  const svg = page.locator("#chat .bubble .chart svg").last();
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(80);
  expect(box?.height ?? 0).toBeGreaterThan(80);

  await chat(page, "laporan banding");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Banding" })).toBeVisible();
});

test("ekspor backup JSON lewat tombol", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await expect(page.locator("#chat .tx").last()).toContainText("Makanan");

  const dl = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^stacker-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const path = await file.path();
  expect(path).toBeTruthy();
});

test("backup kunci menghasilkan file terenkripsi", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await expect(page.locator("#chat .tx").last()).toBeVisible();

  await chat(page, "backup kunci sandi-panjang-2026");
  const link = page.locator("#chat a.dl").last();
  await expect(link).toContainText(".enc.json");

  const dl = page.waitForEvent("download");
  await link.click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.enc\.json$/);

  const { readFile } = await import("node:fs/promises");
  const raw = await readFile((await file.path())!, "utf8");
  expect(raw).toContain('"format":"stacker-enc"');
  expect(raw).not.toContain("transactions");
});

test("modal info menampilkan versi & penyimpanan", async ({ page }) => {
  await boot(page);
  await page.locator("#info").click();
  await expect(page.locator("#infoModal")).toBeVisible();
  await expect(page.locator("#infoLines")).toContainText("Versi: v");
  await expect(page.locator("#infoLines")).toContainText("Backup terakhir:");
  await expect(page.locator("#infoLines")).toContainText("Pemakaian storage:");
  await expect(page.locator("#infoModal .about")).toContainText("Tentang Stacker");
  await expect(page.locator("#infoModal .about")).toContainText("Apache-2.0");
  await expect(page.locator("#infoModal .about")).toContainText("Igoon");

  await page.locator("#infoClose").click();
  await expect(page.locator("#infoModal")).toBeHidden();
});

test("CSP aktif & panel keamanan menampilkan build + hash", async ({ page }) => {
  await boot(page);

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");

  await page.locator("#info").click();
  await expect(page.locator("#infoLines")).toContainText("Build:");
  await expect(page.locator("#infoLines")).toContainText(/Hash bundle SHA-256: [0-9a-f]{64}/, {
    timeout: 15_000,
  });
  await expect(page.locator("#infoLines")).toContainText("Host AI:");
});

test("PIN: kunci otomatis, tolak PIN salah, buka, lalu hapus", async ({ page }) => {
  await boot(page);

  await chat(page, "pin atur 1234");
  await expect(page.locator("#lock")).toBeVisible();

  await page.locator("#lockPin").fill("9999");
  await page.locator("#lockBtn").click();
  await expect(page.locator("#lockMsg")).toContainText("PIN salah");
  await expect(page.locator("#lock")).toBeVisible();

  await page.locator("#lockPin").fill("1234");
  await page.locator("#lockBtn").click();
  await expect(page.locator("#lock")).toBeHidden();

  await chat(page, "pin hapus 1234");
  await expect(page.locator("#chat .bubble").filter({ hasText: "PIN dihapus" })).toBeVisible();

  // Reload: PIN sudah mati, jadi app langsung terbuka tanpa overlay.
  await page.reload();
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#lock")).toBeHidden();
});
