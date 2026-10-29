# Stacker — Mobile (PWA)

Versi gadget bernama **Stacker** (dari project desktop Duit Bot). Berjalan penuh di browser, data tersimpan **lokal
per perangkat** lewat SQLite WASM + OPFS. Tanpa server, tanpa Telegram, tanpa
API key bawaan.

Subproyek terpisah; project desktop (`../src`, `../web`, `../data.db`) tidak
disentuh.

> **Panduan install/uninstall + penggunaan lengkap:** lihat [`GUIDE.md`](GUIDE.md).

## Stack

- `@sqlite.org/sqlite-wasm` `3.54.1-build1` — SQLite di browser.
- VFS `opfs-sahpool` — tidak butuh header COOP/COEP, tapi **satu tab saja**.
- Logika bot (parser lokal + fallback Gemini) jalan di **dedicated worker**
  (OPFS `SyncAccessHandle` hanya tersedia di worker).
- `src/db.ts`, `src/parser.ts`, `src/bot.ts`, `src/chart.ts`, `src/csv.ts`,
  `src/dates.ts` = port/jiplak langsung dari `../src` (logika sama).
- `src/mini-sqlite.ts` = shim meniru subset `better-sqlite3` di atas API oo1.

## Perintah

```sh
npm install
npm run dev        # dev server (localhost, secure context)
npm run build      # hasil di dist/
npm run preview    # sajikan hasil build lokal
npm run verify     # typecheck + smoke (wajib sebelum commit)
npm run smoke      # uji logika inti via sqlite-wasm build Node (in-memory)
npm run e2e        # E2E Playwright (Chrome terpasang, OPFS + worker + UI)
```

E2E memakai `channel: "chrome"` sehingga tak perlu mengunduh browser
Playwright. Server dev dijalankan otomatis di `localhost:5199`.

## CI

`.github/workflows/ci.yml` menjalankan `npm run verify` + `npm run e2e`
(Chromium) untuk setiap push/PR ke `main`. Workflow deploy juga menjalankan
`npm run verify` sebelum build, jadi situs tak ter-deploy kalau logika rusak.

## Persyaratan runtime

- OPFS butuh **secure context**: `https://` atau `localhost`. Buka lewat
  `http://<ip-lokal>` **tidak jalan**.
- `opfs-sahpool` = **satu tab** dalam satu waktu. Tab kedua gagal init (pesan
  error). Tutup tab lama dulu.
- iOS Safari: OPFS `FileSystemSyncAccessHandle` butuh **iOS/iPadOS 16.4+**.
  Storage bisa kena *eviction* kalau penuh; rutin pakai tombol **Backup**.

## AI (opsional, default mati)

- Tombol **AI** di toolbar → modal pengaturan. Dua provider:
  - **Gemini** (default) — gratis pakai free tier (`gemini-2.0-flash`). Isi API key.
  - **OpenAI-compatible** — `{base}/chat/completions` (Ollama lokal, Groq,
    OpenRouter, dsb). Isi base URL + model + key (Ollama lokal tanpa key).
- Konfigurasi disimpan di DB lokal (tabel `settings`), bukan dibundel.
- Key kosong + provider Gemini = AI nonaktif. Provider OpenAI + base URL = aktif
  (walau tanpa key, mis. Ollama).
- Batas 100 panggilan/hari, cache 6 jam. Data keuangan **tidak** dikirim ke
  pihak ketiga kalau pakai Ollama lokal.

## Fitur (ringkas)

- Chat pencatatan transaksi (parser lokal + fallback AI opsional), akun, transfer,
  anggaran + peringatan, laporan/grafik/CSV, cari.
- **Utang/piutang** ledger terpisah (tidak mengubah saldo akun).
- **Transaksi berulang** bulanan (idempotent), **undo** 20 langkah.
- **PIN + auto-lock** (2 menit idle / app ditinggalkan) — kunci tampilan, hash
  PBKDF2, bukan enkripsi disk.
- **Backup terenkripsi** (`backup kunci <sandi>`, AES-GCM 256 + PBKDF2).
- **Auto-backup folder** (File System Access API) + pengingat backup 14 hari,
  status storage permanen (`navigator.storage.persist()`) di modal **ℹ**.
- **Update prompt** service worker ("Versi baru tersedia → Muat ulang").
- Share target PWA (Android/desktop) dan wallpaper chat lokal.
- Parser diuji dengan korpus 20 kalimat (`src/parser-cases.ts`).

## Backup / migrasi

- **Backup** = unduh JSON (`exportAll`). **Restore** = unggah JSON (`importAll`).
- `backup kunci <sandi>` menghasilkan file `.enc.json` terenkripsi; restore
  meminta kata sandi otomatis.
- PIN, API key AI, dan konfigurasi lokal lain **tidak** ikut file backup.
- Data dimulai **kosong** di gadget. Tidak ada migrasi otomatis dari desktop
  `data.db`; kalau perlu, ekspor dari desktop lalu impor di sini (format JSON
  `version: 2` — belum tentu sama dengan format desktop; cek `src/db.ts`).

## Tampilan (wallpaper)

Tombol **🎨** di toolbar: pilih preset warna/gradien atau foto sendiri. Gambar
dikecilkan ke maks 1280 px lalu disimpan **lokal** (localStorage) — tak dikirim
ke mana pun, tak ikut file backup.

## Distribusi

`npm run build` → host folder `dist/` di host statis mana pun (Netlify,
Vercel, GitHub Pages, dsb.). Manifest + service worker sudah disertakan;
buka sekali, lalu "Add to Home Screen".

### GitHub Pages (otomatis)

Repo ini sudah dikonfigurasi deploy otomatis ke GitHub Pages. Setiap push ke
`main` menjalankan `.github/workflows/deploy.yml` (build + deploy). Situs live:
**<https://igoon.github.io/Stacker/>**.

- Source Pages = **GitHub Actions** (sudah aktif).
- `base: "./"` di `vite.config.ts` → semua aset relatif, jalan di subpath
  `/Stacker/` tanpa ubah konfigurasi.
- Deploy manual: tab **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

Tidak perlu header COOP/COEP karena memakai `opfs-sahpool`.

## Lisensi

[Apache-2.0](LICENSE) — © 2026 Igoon (I Go On).

## Versi

`v2.4.0` (MAJOR relatif terhadap jalur desktop, sesuai kebijakan SemVer).
Nilai versi di-hardcode di `src/version.ts` (browser tak bisa baca `package.json`).
