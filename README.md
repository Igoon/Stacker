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
```

## Persyaratan runtime

- OPFS butuh **secure context**: `https://` atau `localhost`. Buka lewat
  `http://<ip-lokal>` **tidak jalan**.
- `opfs-sahpool` = **satu tab** dalam satu waktu. Tab kedua gagal init (pesan
  error). Tutup tab lama dulu.
- iOS Safari: OPFS tersedia iOS 15.2+. Storage bisa kena *eviction* kalau penuh;
  rutin pakai tombol **Backup**.

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

## Backup / migrasi

- **Backup** = unduh JSON (`exportAll`). **Restore** = unggah JSON (`importAll`).
- Data dimulai **kosong** di gadget. Tidak ada migrasi otomatis dari desktop
  `data.db`; kalau perlu, ekspor dari desktop lalu impor di sini (format JSON
  `version: 2` — belum tentu sama dengan format desktop; cek `src/db.ts`).

## Distribusi

`npm run build` → host folder `dist/` di host statis mana pun (Netlify,
Vercel, GitHub Pages, dsb.). Manifest + service worker sudah disertakan;
buka sekali, lalu "Add to Home Screen".

Tidak perlu header COOP/COEP karena memakai `opfs-sahpool`.

## Versi

`v2.0.0` (MAJOR relatif terhadap jalur desktop, sesuai kebijakan SemVer).
Nilai versi di-hardcode di `src/version.ts` (browser tak bisa baca `package.json`).
