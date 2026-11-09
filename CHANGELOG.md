# Changelog

Semua perubahan penting Stacker (mobile). Format berbasis [SemVer](https://semver.org/);
versi MAJOR relatif terhadap jalur desktop.

## [2.18.0]
- **Redo**: pasangan `undo` (maks 20 langkah), perintah `redo`/`ulangi`, tombol
  toolbar, shortcut Ctrl+Y / Ctrl+Shift+Z. Aksi baru mengosongkan redo.
- **Riwayat perintah**: unik (case-insensitive), spasinya dinormalisasi, batas 30,
  perintah undo/redo tidak dicatat, plus tombol **Hapus riwayat**.
- **Tema warna**: 8 tema penuh (Default, Teal, Hutan, Laut, Plum, Pasir, Malam,
  Rose) memengaruhi header, bubble, tombol, modal, menu, keypad, chart, dan PWA
  `theme-color`; wallpaper ikut tema, gambar sendiri tetap didukung.
- **Fix**: `cls` tidak lagi diisi ulang oleh notifikasi/refresh yang telat.

## [2.17.5]
- **Fix atribut `hidden`**: elemen ber-`display` sendiri (mis. `.menu-row`,
  label modal) kini benar-benar tersembunyi. Efeknya: menu **"Pasang aplikasi"**
  tidak tampil bila sudah terpasang/tak didukung, dan baris **"Kunci otomatis"**
  hanya muncul saat PIN aktif.

## [2.17.4]
- **Fix info update tak tampil**: `version.json` kini **selalu diambil dari
  jaringan** (tidak lagi dikembalikan sebagai shell oleh SW). Cache-first hanya
  untuk navigasi dokumen. Versi baru + catatan rilis tampil normal lagi.

## [2.17.3]
- **Fix banner update palsu (race)**: banner menunggu sampai versi app yang
  berjalan diketahui (`appVersion`) sebelum memutuskan. Mencegah notifikasi
  "versi baru" muncul saat app sudah di versi itu (mis. SW dari versi sama masih
  menunggu setelah app pindah versi).

## [2.17.2]
- **Update hanya saat dikonfirmasi**: service worker tidak lagi `skipWaiting`;
  versi baru menunggu sampai tombol **Muat ulang**. Navigasi diubah ke
  **cache-first** supaya app tidak berganti versi diam-diam saat dibuka ulang.
  Banner menampilkan "Versi baru X — kamu di vY".

## [2.17.1]
- **Banner update tidak muncul palsu**: dibandingkan dulu dengan versi yang
  sedang berjalan; bila sudah sama → tidak ditampilkan. Teks kini jelas:
  "Versi baru X — kamu di vY".
- **Sapaan "Halo…" hanya untuk pengguna baru** (belum ada transaksi). Pengguna
  yang sudah punya data melihat hint "N transaksi tersimpan…".

## [2.17.0]
- **App Shortcuts** (manifest): tekan-lama ikon PWA → **Catat cepat / Ringkasan /
  Cari** (`?action=`), berlaku Android & desktop.
- **Badging API**: ikon menampilkan badge angka bila anggaran tembus / transaksi
  berulang jatuh tempo (fallback diam bila tak didukung).
- **Install prompt**: baris "Pasang aplikasi" di ℹ → Pengaturan saat browser
  menawarkan; toast "App terpasang" setelah dipasang.
- **"Dipakai sejak" disimpan di DB** (`settings.first_use_at`): tahan update,
  **tidak ikut backup**, dan **tidak tertimpa restore**; nilai localStorage lama
  dimigrasikan otomatis.

## [2.16.1]
- **Tombol Riwayat (↺)** di samping kolom input (ramah layar sentuh): membuka
  daftar perintah sebelumnya, ketuk untuk memakai. Panah ↑/↓ tetap tersedia
  untuk keyboard/desktop.

## [2.16.0]
- **`cls` / `clear` / `bersihkan`** — membersihkan layar chat (bukan hapus data).
- **Riwayat perintah**: panah ↑/↓ di kolom input untuk memanggil perintah
  sebelumnya, plus **saran chip** dari riwayat saat mengetik.
- **Tentang**: menampilkan **"Dipakai sejak … (N hari)"** + indikator mode
  (terinstall/browser).
- **Getar** (haptic) saat mencatat/undo, toggle di ℹ → Tampilan.
- **Tombol Undo** nonaktif saat tidak ada aksi.
- **Ringkasan**: kartu **"Hari ini"** (jumlah transaksi, keluar/masuk).

## [2.15.0]
- **Update transparan**: banner update menampilkan **versi baru** + ringkasan
  catatan rilis (dibaca dari `version.json` hasil build) sebelum tombol
  "Muat ulang".
- **Feedback menu langsung**: aksi di menu (kategori/akun/anggaran, periksa data,
  pengaturan tampilan/PIN) kini memberi **toast** di atas modal, sehingga tidak
  terasa "tidak ada respon". **Periksa integritas data** menampilkan hasil
  **inline** di modal Reset data.

## [2.14.1]
- Suara pengingat diperbaiki menjadi **bel "tiiing"** (fundamental + partial
  inharmonik, decay panjang, transien pukulan) — tidak lagi sekadar dua nada pendek.
- Tombol **Hapus semua data** dipindah dari **ℹ → Keamanan & PIN** ke
  **ℹ → Reset data** (lebih logis); dokumentasi diselaraskan.

## [2.14.0]
- **Robustness**: index DB (tanggal/kategori/akun/transfer) untuk data besar;
  **Periksa integritas data** (ℹ → Reset data) mendeteksi transfer yatim,
  anggaran tanpa kategori, dan transaksi/berulang merujuk akun hilang.
- **Parser**: turunkan confidence saat **ambigu** (dua kata kunci asli sama
  panjang dari kategori berbeda) → fallback AI.
- **A11y**: `aria-live` pada chat, pil saldo jadi tombol (keyboard + `aria-label`),
  modal `role="dialog"` + tutup dengan `Esc`.
- **UI**: area scroll (daftar) kini panel inset dengan bayangan tepi + scrollbar
  jelas; modal daftar hanya men-scroll daftar, form/footer tetap diam.
- **Bunyi pengingat**: "ting" (Web Audio, tanpa aset) saat pengingat muncul;
  toggle di ℹ → Tampilan. Default aktif (butuh interaksi pertama untuk unlock audio).

## [2.13.0]
- **Akun UI** (ℹ → Akun): daftar akun + form tambah (nama multi-kata, tipe, saldo
  awal); aksi per baris Ubah nama / Sesuaikan / Hapus.
- **Menu ℹ berkelompok**: Keuangan (Ringkasan, Kategori, Akun, Anggaran),
  Pengaturan (Keamanan & PIN, Backup & penyimpanan, Tampilan, AI, Reset data),
  Lainnya (Tentang).
- **Onboarding**: chip contoh perintah saat belum ada transaksi.
- **Pengingat in-app** saat buka: anggaran hampir (≥80%) / tembus & transaksi berulang.
- Parser: `akun tambah` mendukung nama multi-kata.
- Docs: `CHANGELOG.md`, `ROADMAP.md`.

## [2.12.0]
- **Privasi saldo**: total saldo tersamar default (`Saldo: ••••`); ketuk pil saldo
  untuk lihat sementara, auto-samar saat app ditinggalkan. Toggle di ℹ → Tampilan;
  ℹ → Ringkasan ikut tersamar.

## [2.11.1]
- Fix parser: kategori tak lagi salah saat nama akun memuat kata kunci
  (mis. `shopeepay` ⊃ `shopee`). Batas kanan + suffix whitelist untuk kata ≥4 huruf,
  dan abaikan nama akun/@mention saat mencocokkan kategori.

## [2.11.0]
- **Opsi auto-lock PIN** (30 dtk–15 mnt / nonaktif), sadar-visibility.
- **Manajemen Kategori & Anggaran** via menu (bar progres), **Ringkasan** (dashboard
  bulan berjalan: kartu, top, donut, saldo akun).

## [2.10.1]
- Fix tampilan chart terpotong di layar kecil (bubble `.pre` pre-wrap; chart SVG
  lebih lebar; chart teks dipersempit).

## [2.10.0]
- **Kategori**: sintaks toleran (`tambah/buat kategori`, pemisah `| : =`, tanpa
  pemisah = kata pertama nama, default `keduanya`); validasi bentrok kata kunci;
  rename & ubah aman; sinonim `hapus kategori`.
- **Reset data lewat menu** (transaksi/kategori/akun/semua) + auto-backup.

## [2.9.1]
- Dokumentasi: aplikasi asli (bukan demo), storage tab vs terinstall, URL benar.

## [2.9.0]
- **PIN keypad visual** (atur/ubah/hapus lewat ℹ), **Hapus semua data** (wipe OPFS/
  IndexedDB/cache/SW/localStorage), sumber tunggal `COMMAND_WORDS` untuk bot & share target.

## [2.8.0]
- **Alias perintah** (`alias tf transfer`, target multi-kata, hapus/reset).

## [2.7.0]
- Audit P0–P4, offline precache, pengamanan data.

## [2.6.0]
- Paket kepercayaan: CSP, panel keamanan, Tentang.

Lihat `ROADMAP.md` untuk rencana selanjutnya.
