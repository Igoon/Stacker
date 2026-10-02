# AGENTS.md — Duit Bot (finance-bot)

Bot pencatatan keuangan via chat (web + Telegram). TypeScript ESM, Express, SQLite (`better-sqlite3`), parser lokal + fallback Gemini.

## Perintah

- `npm run dev` — jalankan server (tsx watch, port 3000). Proses ini memang jalan terus; jangan ditutup kalau mau app hidup.
- `npm start` — jalan tanpa watch.
- `npm run typecheck` — cek tipe. **Wajib** lolos sebelum commit.
- `npm run smoke` — smoke test di db temp (tak menyentuh `data.db` asli).
- `npm run verify` — `typecheck` + `smoke` sekaligus. **Jalankan ini sebelum commit.**
- `npm run backup` — backup `data.db` manual.

## Verifikasi (urutan wajib tiap perubahan)

1. `npm run verify` (typecheck + smoke, otomatis pakai db temp).
2. Untuk fitur baru, tambah/ubah skenario di `src/smoke.ts`.
3. Restart `npm run dev`, cek log tidak error.
4. Baru commit.

## Larangan / aturan aman

- **Jangan** commit atau buka isi `.env` (rahasia). File ini di-gitignore.
- **Jangan** sentuh/commit `data.db`, `data.db-wal`, `data.db-shm`, `backups/`, `ai-cache.json`, `ai-usage.json`.
- Operasi destruktif (`reset transaksi`, hapus massal) **harus** membuat backup dulu (`backupTagged("pre-...")` sudah tersedia).
- Jangan pernah bind server ke `0.0.0.0` tanpa membahas HTTPS/VPN lebih dulu (Basic auth tanpa TLS = kredensial bocor).
- Jangan kirim data keuangan ke pihak ketiga (mis. layanan chart online).

## Konvensi

- Satu fitur = satu percakapan = satu commit. Pesan commit gaya Conventional: `feat:`, `fix:`, `chore:`, `docs:`.
- Perubahan skema DB: pakai `hasColumn` + `ALTER TABLE` non-destruktif (lihat `src/db.ts`). Jangan drop table.
- Kategori punya sisi `masuk | keluar | keduanya`; arah transaksi ditebak dari kata kunci (`terima/masuk/dapat/gaji/bunga/...` = masuk).
- Parsing lokal dulu; AI (`parseGemini`) hanya fallback saat confidence `low`. Jaga biaya AI: jangan tambah panggilan AI bila bisa diselesaikan lokal.
- Transfer antar akun ditandai `transfer_id` (dua baris). **Dikecualikan** dari total analisa (`ringkasRange`/`dailySeries` default `includeTransfer=false`) dan ditampilkan terpisah; tetap dihitung di saldo akun, CSV, dan riwayat.

## Peta file

- `src/db.ts` — skema + query (accounts, transactions, categories, settings).
- `src/parser.ts` — parser lokal (`parseLocal`) + kata kunci sisi.
- `src/ai.ts` — fallback Gemini (counter harian, cache disk, structured JSON).
- `src/bot.ts` — alur pesan/perintah (`handleMessage`), sumber kebenaran logika.
- `src/telegram.ts` — adapter Telegram (auth PIN/sesi, keypad, kirim pesan/foto/dokumen).
- `src/server.ts` — Express + Basic auth + lockout per-IP.
- `src/dates.ts` — tanggal relatif & periode.
- `src/chart.ts` — chart teks (bar kategori, tren harian).
- `src/csv.ts` — export CSV.
- `src/smoke.ts` — smoke test (db temp via `DUIT_DB_DIR`).
- `src/backup.ts` — backup harian + `backupTagged`.
- `web/index.html` — UI chat web.

## Kebijakan versi (SemVer)

- **MAJOR** — perubahan tak kompatibel: skema destruktif, hapus/ubah perintah, atau ubah arti saldo yang memaksa migrasi.
- **MINOR** — fitur baru yang kompatibel: perintah, kategori, keamanan, chart.
- **PATCH** — bugfix.
- Aturan: tiap rilis fitur → bump versi di `package.json` + `git tag` (mis. `v1.5.0`). Versi ditampilkan lewat perintah `versi`.

## Auto-start Windows (saat login, tanpa admin)

- Pasang: `powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1`
- Lepas: `powershell -ExecutionPolicy Bypass -File scripts\uninstall-startup.ps1`
- Cara kerja: VBS di folder Startup → `cmd` tersembunyi, tunggu ~15 detik, lalu `node <tsx> src\server.ts`. Log: `finance-bot.log` di root proyek.
- Jalan **saat login**, bukan sebelum login. Butuh internet untuk Telegram.
- Jangan jalankan `npm run dev` bersamaan di port 3000 (server auto-exit saat `EADDRINUSE`).

## Workflow

Plan dulu untuk desain; Build untuk eksekusi. Ubah kecil, verifikasi, commit. Jangan ganti stack tengah jalan.