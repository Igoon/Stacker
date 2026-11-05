import { expect, test, type Page } from "@playwright/test";

// Tiap tes dapat context baru => OPFS bersih, jadi urutan tak saling ganggu.

async function boot(page: Page): Promise<void> {
  // Web Share API dimatikan supaya ekspor selalu jatuh ke unduhan biasa
  // (deterministik di headless).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    // Saldo default tersamar; tes yang memeriksa nominal perlu menampilkannya.
    try {
      localStorage.setItem("stacker-hide-saldo", "0");
    } catch {
      // abaikan
    }
  });
  await page.goto("/");
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
}

async function chat(page: Page, text: string): Promise<void> {
  const input = page.locator("#input");
  await input.fill(text);
  await input.press("Enter");
}

async function tapPad(page: Page, pad: "#lockPad" | "#pinPad", pin: string): Promise<void> {
  for (const d of pin) {
    await page.locator(`${pad} button[data-key="${d}"]`).click();
  }
}

async function submitPad(page: Page, pad: "#lockPad" | "#pinPad"): Promise<void> {
  await page.locator(`${pad} button[data-key="ok"]`).click();
}

async function setPinUi(page: Page, pin: string): Promise<void> {
  await page.locator("#info").click();
  await page.locator("#openSecurity").click();
  await page.locator("#pinSetBtn").click();
  await tapPad(page, "#pinPad", pin);
  await submitPad(page, "#pinPad");
  await expect(page.locator("#pinHint")).toContainText("Ulangi");
  await tapPad(page, "#pinPad", pin);
  await submitPad(page, "#pinPad");
  await expect(page.locator("#lock")).toBeVisible();
}

async function unlockUi(page: Page, pin: string): Promise<void> {
  await tapPad(page, "#lockPad", pin);
  await submitPad(page, "#lockPad");
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

test("pengingat backup tidak diulang tiap kirim", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await chat(page, "teh 5rb");
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "Belum pernah backup" })
  ).toHaveCount(1);
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

  await chat(page, "grafik");
  await expect(page.locator("#chat .bubble.pre").last()).toBeVisible();
});

test("chart tidak terpotong di layar kecil", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await boot(page);
  for (const c of ["makan 50rb", "transport 30rb", "belanja 20rb", "kopi 10rb", "gaji 5jt"]) {
    await chat(page, c);
  }
  await chat(page, "grafik");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Keluar per kategori" })).toBeVisible();
  await chat(page, "grafik tren 6");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Tren 6 bulan" })).toBeVisible();

  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#chat .bubble")).some(
      (b) => (b as HTMLElement).scrollWidth > (b as HTMLElement).clientWidth + 1
    )
  );
  expect(overflow).toBe(false);
});

test("share target berisi perintah tidak auto-jalan", async ({ page }) => {
  await page.goto("/?text=reset%20transaksi");
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#input")).toHaveValue("reset transaksi");
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "Semua transaksi dihapus" })
  ).toHaveCount(0);
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "berisi perintah" })
  ).toBeVisible();
});

test("share target dengan alias/sesuaikan tidak auto-jalan", async ({ page }) => {
  await page.goto("/?text=alias%20tf%20transfer");
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#input")).toHaveValue("alias tf transfer");
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "berisi perintah" })
  ).toBeVisible();

  await page.goto("/?text=sesuaikan%20bsi%20100jt");
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#input")).toHaveValue("sesuaikan bsi 100jt");
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "berisi perintah" })
  ).toBeVisible();
});

test("tombol undo membatalkan aksi terakhir", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await page.locator("#undo").click();
  await expect(page.locator("#chat .bubble").filter({ hasText: "Dibatalkan" })).toBeVisible();
  await expect(page.locator("#saldo")).toHaveText(/Rp0/);
});

test("tombol backup terenkripsi", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await page.locator("#info").click();
  await page.locator("#openStorage").click();
  await page.locator("#exportEnc").click();
  await expect(page.locator("#passModal")).toBeVisible();
  await page.locator("#passInput").fill("sandi-panjang-2026");
  await page.locator("#passOk").click();
  await expect(page.locator("#chat a.dl").last()).toContainText(".enc.json");
});

test("dua pesan cepat diproses berurutan", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 10rb");
  await chat(page, "teh 5rb");
  await expect(page.locator("#chat .tx")).toHaveCount(2);
  await expect(page.locator("#saldo")).toHaveText(/-Rp15\.000/);
});

test("alias tf dipakai untuk transfer", async ({ page }) => {
  await boot(page);
  await chat(page, "alias tf transfer");
  await expect(page.locator("#chat .bubble").filter({ hasText: "tf → transfer" }).last()).toBeVisible();
  await chat(page, "tf 10rb bsi ke gopay");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Transfer Rp10.000" })).toBeVisible();
  await expect(page.locator("#saldo")).toHaveText(/Rp0/);
  await chat(page, "alias");
  await expect(page.locator("#chat .bubble").filter({ hasText: "tf → transfer" }).last()).toBeVisible();

  // Alias juga berlaku untuk teks yang dibagikan dari app lain.
  await page.goto("/?text=" + encodeURIComponent("tf 5rb bsi ke gopay"));
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "Transfer Rp5.000" })
  ).toBeVisible();
});

test("reset transaksi minta konfirmasi dulu", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await expect(page.locator("#chat .tx")).toHaveCount(1);

  page.once("dialog", (d) => d.dismiss());
  await chat(page, "reset transaksi");
  await expect(page.locator("#chat .tx")).toHaveCount(1, { timeout: 3000 });

  page.once("dialog", (d) => d.accept());
  await chat(page, "reset transaksi");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Semua transaksi dihapus" })).toBeVisible();
  await expect(page.locator("#chat .tx")).toHaveCount(0);
});

test("menu Reset data menjalankan reset transaksi", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await expect(page.locator("#chat .tx")).toHaveCount(1);

  page.once("dialog", (d) => d.accept());
  await page.locator("#info").click();
  await page.locator("#openReset").click();
  await page.locator("#resetTxBtn").click();
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "Semua transaksi dihapus" })
  ).toBeVisible();
  await expect(page.locator("#chat .tx")).toHaveCount(0);
});

test("reset semua minta konfirmasi & mengosongkan data", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await expect(page.locator("#saldo")).toHaveText(/-Rp15\.000/);

  page.once("dialog", (d) => d.accept());
  await chat(page, "reset semua");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Reset total" })).toBeVisible();
  await expect(page.locator("#saldo")).toHaveText(/Rp0/);
  await expect(page.locator("#chat .tx")).toHaveCount(0);
});

test("hapus via perintah menyinkronkan bubble", async ({ page }) => {
  await boot(page);
  await chat(page, "makan 50rb");
  const text = await page.locator("#chat .tx").last().innerText();
  const id = text.match(/#(\d+)/)?.[1];
  expect(id).toBeTruthy();
  await chat(page, `hapus #${id}`);
  await expect(page.locator("#chat .tx")).toHaveCount(0);
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

test("restore minta konfirmasi dan bisa di-undo", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");

  const dl = page.waitForEvent("download");
  await page.locator("#export").click();
  const path = await (await dl).path();
  expect(path).toBeTruthy();

  await chat(page, "teh 5rb");

  page.once("dialog", (d) => d.accept());
  await page.locator("#importFile").setInputFiles(path!);
  await expect(page.locator("#chat .bubble").filter({ hasText: "Backup dimuat" })).toBeVisible();

  await chat(page, "undo");
  await expect(page.locator("#chat .bubble").filter({ hasText: "Dibatalkan" })).toBeVisible();
  await chat(page, "riwayat 10");
  await expect(page.locator("#chat .bubble").filter({ hasText: "teh" })).toBeVisible();
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

  // Sandi salah tidak boleh menutup modal; bisa coba lagi tanpa pilih file ulang.
  page.once("dialog", (d) => d.accept());
  await page.locator("#importFile").setInputFiles((await file.path())!);
  await expect(page.locator("#passModal")).toBeVisible();
  await page.locator("#passInput").fill("sandi-salah");
  await page.locator("#passOk").click();
  await expect(page.locator("#passModal")).toBeVisible();
  await expect(page.locator("#passMsg")).toContainText("salah");
  await page.locator("#passInput").fill("sandi-panjang-2026");
  await page.locator("#passOk").click();
  await expect(page.locator("#chat .bubble").filter({ hasText: "Backup dimuat" })).toBeVisible();
});

test("modal info ringkas + sub-modal (storage & tentang)", async ({ page }) => {
  await boot(page);
  await page.locator("#info").click();
  await expect(page.locator("#infoModal")).toBeVisible();
  await expect(page.locator("#infoSummary")).toContainText(/v\d/);
  await expect(page.locator("#infoSummary")).toContainText("transaksi");

  await page.locator("#openStorage").click();
  await expect(page.locator("#storeModal")).toBeVisible();
  await expect(page.locator("#storeLines")).toContainText("Backup terakhir:");
  await expect(page.locator("#storeLines")).toContainText("Pemakaian storage:");
  await expect(page.locator("#retain")).toHaveValue("30");

  await page.locator("#storeBack").click();
  await expect(page.locator("#infoModal")).toBeVisible();
  await page.locator("#openAbout").click();
  await expect(page.locator("#aboutModal")).toBeVisible();
  await expect(page.locator("#aboutLines")).toContainText("Versi: v");
  await expect(page.locator("#aboutLines")).toContainText("Host AI:");
  await expect(page.locator("#aboutModal h3")).toContainText("Tentang Stacker");
  await expect(page.locator("#aboutModal .about")).toContainText("Apache-2.0");
  await expect(page.locator("#aboutModal .about")).toContainText("Igoon");

  await page.locator("#aboutBack").click();
  await expect(page.locator("#infoModal")).toBeVisible();

  await page.locator("#openWall").click();
  await expect(page.locator("#wallModal")).toBeVisible();
  await page.locator("#wallClose").click();

  await page.locator("#info").click();
  await page.locator("#openAI").click();
  await expect(page.locator("#aiModal")).toBeVisible();
  await page.locator("#aiCancel").click();

  await page.locator("#info").click();
  await page.locator("#infoClose").click();
  await expect(page.locator("#infoModal")).toBeHidden();
});

test("saldo tersamar default & ketuk untuk lihat", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await chat(page, "kopi 15rb");
  await expect(page.locator("#saldo")).toContainText("••••");
  await page.locator("#saldo").click();
  await expect(page.locator("#saldo")).toContainText("-Rp15.000");
});

test("menu Kategori, Anggaran, dan Ringkasan", async ({ page }) => {
  await boot(page);

  await page.locator("#info").click();
  await page.locator("#openCat").click();
  await page.locator("#catName").fill("Sosial");
  await page.locator("#catTipe").selectOption("keluar");
  await page.locator("#catKw").fill("sosial, jimpitan");
  await page.locator("#catSave").click();
  await expect(page.locator("#catList")).toContainText("Sosial");
  await page.locator("#catBack").click();

  await page.locator("#openBudget").click();
  await page.locator("#budgetCat").selectOption("Sosial");
  await page.locator("#budgetJumlah").fill("100rb");
  await page.locator("#budgetSave").click();
  await expect(page.locator("#budgetList")).toContainText("Sosial");
  await expect(page.locator("#budgetList .bar")).toBeVisible();
  await page.locator("#budgetBack").click();

  await page.locator("#openDash").click();
  await expect(page.locator("#dashBody .dash-card").first()).toBeVisible();
  await page.locator("#dashBack").click();
});

test("menu Akun: tambah multi-kata, sesuaikan, hapus", async ({ page }) => {
  await boot(page);
  await page.locator("#info").click();
  await page.locator("#openAcc").click();
  await page.locator("#accName").fill("Rumah Tangga");
  await page.locator("#accTipe").selectOption("bank");
  await page.locator("#accSaldo").fill("1jt");
  await page.locator("#accSave").click();
  await expect(page.locator("#accList")).toContainText("Rumah Tangga");

  page.once("dialog", (d) => void d.accept("2jt"));
  await page
    .locator("#accList .cat-item")
    .filter({ hasText: "Rumah Tangga" })
    .getByText("Sesuaikan")
    .click();
  await expect(page.locator("#accList")).toContainText("Rp2.000.000");

  page.once("dialog", (d) => void d.accept());
  await page
    .locator("#accList .cat-item")
    .filter({ hasText: "Rumah Tangga" })
    .getByText("Hapus")
    .click();
  await expect(page.locator("#accList")).not.toContainText("Rumah Tangga");
  await page.locator("#accBack").click();
});

test("chip cepat mengisi input saat belum ada transaksi", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#chips")).toBeVisible();
  await page.locator("#chips button", { hasText: "gaji 5jt" }).click();
  await expect(page.locator("#input")).toHaveValue("gaji 5jt");
});

test("Hapus semua data ada di Reset data, bukan Keamanan", async ({ page }) => {
  await boot(page);
  await page.locator("#info").click();
  await page.locator("#openSecurity").click();
  await expect(page.locator("#wipeData")).toBeHidden();
  await page.locator("#secBack").click();
  await page.locator("#openReset").click();
  await expect(page.locator("#wipeData")).toBeVisible();
  await page.locator("#resetBack").click();
});

test("Periksa data & toggle bunyi pengingat", async ({ page }) => {
  await boot(page);
  await page.locator("#info").click();
  await page.locator("#openReset").click();
  await page.locator("#checkData").click();
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "tidak ada masalah" })
  ).toBeVisible();
  await page.locator("#resetBack").click();

  await page.locator("#openWall").click();
  await expect(page.locator("#soundNotice")).toBeChecked();
  await page.locator("#soundNotice").uncheck();
  await expect(
    page.locator("#chat .bubble").filter({ hasText: "Bunyi pengingat dimatikan" })
  ).toBeVisible();
  await page.locator("#wallClose").click();
});

test("CSP aktif & panel keamanan menampilkan build + hash", async ({ page }) => {
  await boot(page);

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");

  await page.locator("#info").click();
  await page.locator("#openAbout").click();
  await expect(page.locator("#aboutLines")).toContainText("Build:");
  await expect(page.locator("#aboutLines")).toContainText(/Hash bundle SHA-256: [0-9a-f]{64}/, {
    timeout: 15_000,
  });
  await expect(page.locator("#aboutLines")).toContainText("Host AI:");
});

test("cooldown PIN bertahan setelah reload (keypad visual)", async ({ page }) => {
  await boot(page);
  await setPinUi(page, "1234");
  await expect(page.locator("#lock")).toBeVisible();

  for (let i = 1; i <= 5; i++) {
    await tapPad(page, "#lockPad", "0000");
    await submitPad(page, "#lockPad");
    await expect(page.locator("#lockMsg")).toContainText(
      i < 5 ? `PIN salah (${i}/5)` : "Terlalu banyak salah"
    );
  }

  await page.reload();
  await expect(page.locator("#lock")).toBeVisible({ timeout: 60_000 });
  await tapPad(page, "#lockPad", "1234");
  await submitPad(page, "#lockPad");
  await expect(page.locator("#lockMsg")).toContainText("Tunggu");
  await expect(page.locator("#lock")).toBeVisible();
});

test("PIN: set via keypad, ubah, unlock, hapus", async ({ page }) => {
  await boot(page);
  await setPinUi(page, "1234");
  await expect(page.locator("#chat .bubble").filter({ hasText: "1234" })).toHaveCount(0);

  await tapPad(page, "#lockPad", "9999");
  await submitPad(page, "#lockPad");
  await expect(page.locator("#lockMsg")).toContainText("PIN salah");
  await expect(page.locator("#lock")).toBeVisible();

  await unlockUi(page, "1234");
  await expect(page.locator("#lock")).toBeHidden();

  // Ubah PIN lewat sub-modal Keamanan di ℹ.
  await page.locator("#info").click();
  await page.locator("#openSecurity").click();
  await page.locator("#pinChangeBtn").click();
  await tapPad(page, "#pinPad", "1234");
  await submitPad(page, "#pinPad");
  await expect(page.locator("#pinHint")).toContainText("PIN baru");
  await tapPad(page, "#pinPad", "5678");
  await submitPad(page, "#pinPad");
  await expect(page.locator("#pinHint")).toContainText("Ulangi");
  await tapPad(page, "#pinPad", "5678");
  await submitPad(page, "#pinPad");
  await expect(page.locator("#lock")).toBeVisible();

  await unlockUi(page, "5678");
  await expect(page.locator("#lock")).toBeHidden();

  // Hapus PIN.
  await page.locator("#info").click();
  await page.locator("#openSecurity").click();
  await page.locator("#pinDeleteBtn").click();
  await tapPad(page, "#pinPad", "5678");
  await submitPad(page, "#pinPad");
  await expect(page.locator("#secModal")).toBeVisible();
  await page.locator("#secBack").click();
  await page.locator("#infoClose").click();
  await expect(page.locator("#chat .bubble").filter({ hasText: "PIN dihapus" })).toBeVisible();

  // Reload: PIN sudah mati, jadi app langsung terbuka tanpa overlay.
  await page.reload();
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#lock")).toBeHidden();
});

test("hapus semua data membersihkan storage dan mereset app", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await expect(page.locator("#saldo")).toHaveText(/-Rp15\.000/);
  await page.evaluate(() =>
    localStorage.setItem("stacker-wallpaper", JSON.stringify({ kind: "default" }))
  );

  page.on("dialog", (d) => void d.accept());
  await page.locator("#info").click();
  await page.locator("#openReset").click();
  await page.locator("#wipeData").click();

  // Reload otomatis: app kembali bersih dan localStorage dibersihkan.
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#saldo")).toHaveText(/Rp0/);
  expect(await page.evaluate(() => localStorage.getItem("stacker-wallpaper"))).toBeNull();
});

test("hapus semua data wajib PIN bila PIN aktif", async ({ page }) => {
  await boot(page);
  await chat(page, "kopi 15rb");
  await setPinUi(page, "1234");
  await unlockUi(page, "1234");
  await expect(page.locator("#lock")).toBeHidden();

  page.on("dialog", (d) => void d.accept());
  await page.locator("#info").click();
  await page.locator("#openReset").click();
  await page.locator("#wipeData").click();
  await expect(page.locator("#pinModal")).toBeVisible();

  // PIN salah ditolak; modal tetap terbuka.
  await tapPad(page, "#pinPad", "0000");
  await submitPad(page, "#pinPad");
  await expect(page.locator("#pinMsg")).toContainText("salah");
  await expect(page.locator("#pinModal")).toBeVisible();

  // PIN benar -> lanjut hapus.
  await tapPad(page, "#pinPad", "1234");
  await submitPad(page, "#pinPad");
  await expect(page.locator("#sub")).toHaveText(/^v\d/, { timeout: 60_000 });
  await expect(page.locator("#lock")).toBeHidden();
  await expect(page.locator("#saldo")).toHaveText(/Rp0/);
});
