# Changelog

Semua perubahan penting Stacker (mobile). Format berbasis [SemVer](https://semver.org/);
versi MAJOR relatif terhadap jalur desktop.

## [2.37.0]
- **Edit transaksi cepat**: tombol **Ubah** langsung di kartu transaksi pada chat untuk mengedit nominal, tanggal, kategori, akun, dan catatan tanpa mengetik perintah.
- **Navigasi bulan di Dashboard**: tombol `<` dan `>` di Ringkasan untuk melihat grafik, alokasi, dan pengeluaran bulan-bulan sebelumnya.
- **Export CSV langsung dari UI**: tombol **Export CSV** di modal **Cari transaksi** (sesuai filter aktif) dan di **Backup & penyimpanan** (semua transaksi).
- **Autocomplete `@akun`**: ketik `@` di kolom chat untuk memunculkan saran nama akun secara otomatis.
- **Peringatan transaksi duplikat**: deteksi transaksi identik dalam 2 menit terakhir dengan pengingat cepat untuk `undo` jika tidak sengaja dobel.
- **Optimasi UI & perbaikan bug**: akses cepat **Dashboard** & **Cari** di bar bawah, form filter Cari 2 kolom yang lebih ringkas, pembeda warna kartu pemasukan/pengeluaran, *backdrop click* penutup modal, animasi halus, serta perbaikan bug slider wallpaper, format Rupiah negatif, sinkronisasi header dari modal, tema terang, dan notifikasi transaksi berulang saat boot.

## [2.35.0]
- **Tema "Otomatis"**: opsi tema baru — otomatis memakai tema terang (**Langit**)
  pada siang hari dan **Default** (gelap) pada malam hari. Dicek ulang tiap menit
  dan saat app kembali dibuka.
- **Hapus opsi "Samarkan nominal transaksi di chat"** dari **Tema & tampilan**;
  nominal transaksi kini selalu ditampilkan di chat.

## [2.34.0]
- **Panic blur otomatis saat menganggur**: selain saat app ditinggal, layar ikut
  disamarkan bila tak ada aktivitas (mengatasi OS yang menangkap snapshot sebelum
  event). Durasi diatur di **Tema & tampilan** (30 dtk / 1 / 2 / 5 mnt, atau
  nonaktif). Ketuk layar untuk kembali normal.

## [2.33.0]
- **Skor kesehatan finansial (0–100)**: kartu gauge di Ringkasan + perintah
  `skor`. Menilai rasio tabungan (30%), kepatuhan anggaran (20%), beban utang
  (20%), dana darurat (15%), dan konsistensi mencatat (15%), plus satu saran
  perbaikan. Rule-based, lokal, tanpa AI.
- **Panic blur**: layar otomatis **disamarkan (blur)** saat app ditinggal/pindah
  dan normal lagi saat dibuka. Toggle di **Tema & tampilan** (default aktif).

## [2.32.0]
- **Ikon kategori bisa dicustom**: di **Info › Kategori** ada pilihan **Ikon**
  (makanan, transportasi, belanja, tagihan, kesehatan, hiburan, gaji, tabungan,
  investasi, transfer, atau "otomatis dari nama"). Ikon tampil di daftar
  kategori dan kartu transaksi; ikut backup/restore. Perintah chat:
  `kategori ikon <nama> <ikon|auto>`.

## [2.31.1]
- **Update lebih mulus**: saat auto-update muncul toast **"Memperbarui ke vX…"**
  sebelum reload (tak lagi reload senyap). Perbandingan versi kini **semver**
  (hanya update bila benar-benar lebih baru), waktu tunggu auto lebih singkat,
  dan panel **Tentang** menampilkan **versi server + status**
  ("terbaru"/"update tersedia").

## [2.31.0]
- **Ikon kategori SVG** di kartu transaksi (makanan, transportasi, belanja,
  tagihan, kesehatan, hiburan, gaji, tabungan, investasi, transfer; fallback
  ikon tag). Ikut warna tema — lebih cepat dikenali daripada awalan huruf.
- **Update otomatis saat dibuka**: jika server punya versi lebih baru, app
  memeriksa & menerapkan Service Worker baru otomatis (sekali per versi), tak
  lagi bergantung pada banner. Tombol **Info › Periksa pembaruan** tetap ada.

## [2.30.1]
- **Kartu transaksi dirapikan**: hilangkan **duplikasi akun** (akun tak lagi
  diulang di judul "Tercatat"), tambah **ikon awalan kategori**, dan susun baris
  ala bank (ikon · kategori · nominal; lalu akun · #id). Rapi di tema gelap &
  terang.

## [2.30.0]
- **Kartu transaksi di chat**: tiap transaksi kini tampil sebagai **kartu** rapi
  (nominal, badge kategori, akun · #id, tombol hapus) — lebih mudah dibaca.
- **Chip perintah cepat** di atas kolom input: Ringkasan, Alokasi, Target,
  Berulang, sekali ketuk.

## [2.29.0]
- **Tema terang "Langit"** (biru seperti mockup): palet terang dengan aksen biru,
  di samping tema gelap. Default tetap **gelap** (privasi). Sekaligus merapikan
  warna teks bubble user, toolbar, chips, dan tombol riwayat agar terbaca di tema
  terang (lolos kontras WCAG AA).

## [2.28.0]
- **Panduan 50/30/20**: perintah `alokasi` + bagian **Alokasi 50/30/20** di
  Ringkasan. Dari pemasukan bulan ini: kebutuhan (≤50%), keinginan (≤30%),
  tabungan/sisa (≥20%), dengan bar progres. Klasifikasi kategori mengikuti nama
  umum (Makanan/Transportasi/Tagihan/Kesehatan→kebutuhan; Belanja/Hiburan→
  keinginan; lainnya→keinginan; Tabungan/Investasi/Donasi→tabungan). Transfer
  dikecualikan.

## [2.27.0]
- **Target & sinking fund**: menu **Info › Target** + perintah `target`. Buat
  target tabungan (mis. `target Liburan 5jt tempo 2027-06-01`), lihat progres
  (bar %), **saran sisihkan/bulan** dari tempo, isi/ambil berkala
  (`target isi|ambil <nama> <nominal>`), dan hapus. Cocok untuk dana darurat
  maupun sinking fund (pengeluaran terjadwal). Ikut backup/restore.

## [2.26.1]
- **Periksa pembaruan (manual)**: menu baru **Info › Periksa pembaruan** untuk
  memaksa cek Service Worker lalu mengaktifkan + memuat ulang versi terbaru.
  Membantu PWA yang terinstall di HP ketika banner update tidak muncul. SW yang
  "menunggu" juga ditawarkan tiap app kembali ke depan (foreground).

## [2.26.0]
- **Samarkan nominal di chat**: opsi baru di **Info › Tema & tampilan** untuk
  menyamarkan semua nominal rupiah di bubble chat (jadi `Rp••••`) — praktis saat
  menunjukkan layar. Angka non-uang (id, tanggal, jumlah transaksi) tetap
  tampil. Default mati (opt-in).

## [2.25.0]
- **Ringkasan++ (dashboard)**: tambah **Net worth** (saldo akun + piutang −
  utang), kartu **Utang** & **Piutang**, **Proyeksi net bulan ini** (run-rate),
  **Rata-rata net 3 bulan**, dan **grafik Tren 6 bulan** (masuk vs keluar) —
  melengkapi donut komposisi yang sudah ada.

## [2.24.0]
- **Deteksi langganan otomatis**: Stacker mengenali **pengeluaran yang muncul
  tiap bulan dengan nominal sama** (mis. langganan/langganan digital) dari
  riwayat, lalu menawarkannya di **Info › Langganan** untuk dijadikan `berulang`
  cukup satu klik. Berbasis riwayat lokal — tidak ada data yang keluar.

## [2.23.0]
- **Auto-kategorisasi on-device**: bila kategori tak dikenali, Stacker menebak
  dari **riwayat transaksimu sendiri** (kata yang sama pernah masuk kategori X)
  — **tanpa AI**, jadi hemat kuota. Kategori hasil tebakan diberi catatan
  "(ditebak dari riwayat)"; koreksi lewat `ubah #id kategori ...` otomatis
  memperkuat tebakan berikutnya.

## [2.22.2]
- **Update lebih cepat**: registrasi service worker memakai
  `updateViaCache: "none"` + cek update tepat saat app dibuka, sehingga `sw.js`
  tak lagi tertahan cache HTTP GitHub Pages (~10 menit). Banner "Versi baru"
  lebih cepat muncul — terutama pada PWA yang terinstall di HP.

## [2.22.1]
- **UI menu Info**: dirapikan — "Cari" dinaikkan ke atas, baris menu lebih
  rapat, dan daftar menu punya scroll sendiri sehingga judul + tombol "Tutup"
  selalu terlihat (sebelumnya seluruh modal ikut bergeser).

## [2.22.0]
- **Menu Cari (UI)**: filter transaksi lewat **Info › Cari** — kata kunci
  (catatan/kategori/akun), akun, kategori, rentang tanggal, dan nominal
  min/maks. Hasil menampilkan jumlah + daftar (id, tanggal, tipe, nominal,
  akun, catatan).

## [2.21.0]
- **Menu Utang/Piutang (UI)**: kelola lewat **Info › Utang/Piutang** — daftar
  (sisa per item + total utang/piutang), tambah, bayar sebagian/lunas, dan hapus.
  Sama seperti chat (bisa di-undo); ledger tetap terpisah dari saldo akun.

## [2.20.0]
- **Menu Berulang (UI)**: tambah/kelola transaksi berulang lewat menu
  (**Info › Berulang**) tanpa harus ketik perintah — daftar, aktif/nonaktif,
  ubah nominal & tanggal, hapus. Membuat tetap lewat jalur chat yang sama,
  jadi tetap bisa di-undo.

## [2.19.0]
- **Header saldo 2 baris**: pil saldo kanan atas kini menampilkan **Saldo** plus
  baris ringkas **masuk · keluar bulan berjalan** (mis. `Saldo Rp10jt` lalu
  `+2jt · −500rb`). Angka dipendekkan (`10.000.000` → `Rp10jt`) agar muat.
  Tetap satu ketukan untuk lihat/samarkan (privasi bawaan). Transfer
  dikecualikan dari hitungan, sama seperti laporan.

## [2.18.3]
- **Fix**: tanggal di **awal** pesan (mis. `2026-11-11 transfer 10rb bsi ke
  gopay` atau `kemarin transfer 10rb bsi ke gopay`) tidak lagi menghalangi
  deteksi perintah. Sebelumnya pesan seperti itu tercatat sebagai satu
  pengeluaran biasa, bukan transfer dua sisi.

## [2.18.2]
- **Auto-backup folder**: bila izin folder perlu diperbarui, tombol memakai
  handle folder tersimpan (**Izinkan folder tersimpan**) sehingga tidak membuka
  pemilih folder lagi; label tombol menyesuaikan (pilih/izinkan/ganti) dan ada
  indikator **Perlu izin** di menu penyimpanan. Teks bantuan backup/restore
  diperjelas.
- **Wallpaper kustom** tidak lagi hilang saat mengganti tema.
- **Undo/Redo**: snapshot dibatasi berdasarkan ukuran memori dan label aksi
  (tooltip tombol); perintah baca tidak lagi membuat snapshot; timestamp backup
  lokal tidak ikut ter-undo; kegagalan restore tidak menghilangkan langkah.

## [2.18.1]
- **UI**: tombol Backup/Restore JSON dipindah dari toolbar ke menu
  **Info → Backup & penyimpanan** (toolbar kini hanya Undo, Redo, Info).

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
