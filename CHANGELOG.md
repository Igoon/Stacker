# Changelog

Semua perubahan penting Stacker (mobile). Format berbasis [SemVer](https://semver.org/);
versi MAJOR relatif terhadap jalur desktop.

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
