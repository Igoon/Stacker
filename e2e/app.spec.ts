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
