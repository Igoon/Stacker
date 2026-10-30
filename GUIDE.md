# Stacker — Panduan Instalasi & Penggunaan

Stacker versi PWA (Progressive Web App). Berjalan penuh di browser, data
keuangan tersimpan **lokal di perangkat kamu** (SQLite + OPFS). Tanpa server,
tanpa akun, tanpa kirim data ke luar. Bisa dipasang seperti aplikasi biasa.

---

## 1. Syarat

- Buka lewat **HTTPS** atau **localhost**. `http://` biasa tidak jalan (OPFS
  butuh secure context).
- **Satu tab saja**. Tab kedua akan gagal buka database. Tutup tab lama dulu.
- **iOS/iPadOS 16.4+** (Safari). OPFS `FileSystemSyncAccessHandle` baru ada di
  versi itu; iOS lebih lama akan gagal buka database.
- Android: Chrome/Edge/Firefox versi 2023 ke atas.

---

## 2. Cara Install

### Android — Chrome (paling umum)

1. Buka URL aplikasi di Chrome.
2. Tunggu sebentar, muncul banner **"Tambahkan Stacker ke layar utama"**
   atau ikon **⊕ Install** di menu.
3. Kalau tidak muncul: ketuk menu **⋮ (tiga titik)** → **Tambahkan ke layar utama**
   (atau **Install app**).
4. Ketuk **Tambah / Install**. Ikon muncul di home screen.

### Android — Samsung Internet / Firefox

1. Buka URL.
2. Samsung Internet: menu **≡** → **Tambahkan ke layar utama**.
3. Firefox: menu **⋮** → **Install**.

### iPhone / iPad — Safari

1. Buka URL di **Safari** (wajib Safari; Chrome iOS tidak bisa install PWA).
2. Ketuk tombol **Bagikan (kotak + panah atas)**.
3. Gulir, pilih **Tambahkan ke Layar Utama (Add to Home Screen)**.
4. Ketuk **Tambah**. Ikon muncul di home screen.

Catatan iOS:
- **Pasang ke Home Screen**, jangan cuma dibiarkan di tab Safari. Data situs
  yang tak pernah dikunjungi 7 hari bisa dibersihkan Safari; app terpasang
  jauh lebih aman.
- **Share target tidak tersedia** di iOS (Safari belum mendukung Web Share
  Target). Salin teks notifikasi lalu tempel ke kolom chat.
- Unduhan **CSV/JSON** membuka lembar **Bagikan** → pilih **Simpan ke Files**.

### Desktop — Chrome / Edge

1. Buka URL.
2. Klik ikon **Install (⊞ dengan panah bawah)** di pojok kanan address bar.
3. Konfirmasi **Install**. Aplikasi terbuka di jendela sendiri.

---

## 3. Cara Uninstall

### Android

1. Tekan lama ikon aplikasi di home screen.
2. Pilih **Hapus / Uninstall** (atau seret ke **Hapus**).
3. Konfirmasi. Data lokal ikut terhapus (pastikan sudah **Backup** kalau mau).

### iPhone / iPad

1. Tekan lama ikon aplikasi.
2. Ketuk **Hapus Aplikasi (Remove App)** → **Hapus dari Layar Utama**.

### Desktop

1. Di jendela aplikasi, klik menu **⋮** (atau **⋯** di Edge).
2. Pilih **Uninstall Stacker** / **Hapus**.

> **Penting:** Uninstall = data lokal hilang. Ekspor dulu lewat tombol
> **⬇ Backup** kalau data mau dipindah/disimpan.

---

## 4. Penggunaan Dasar

> **Catatan:** Stacker **tanpa login/logout**. Buka langsung pakai, tutup
> saja kalau selesai — data tersimpan otomatis di perangkat. PIN kunci layar
> **opsional** (lihat bagian 8).

### Alur pertama kali (dari nol)

1. Buka app (atau `https://igoon.github.io/Stacker/`).
2. Set saldo awal akun (opsional; akun default sudah ada: Cash, BSI, Jago,
   GoPay, OVO, DANA, ShopeePay, Flip):
   ```
   saldo awal bsi 5.000.000
   ```
3. Catat transaksi (kategori auto ditebak dari kata kunci; default kategori
   sudah siap — tidak perlu buat kategori dulu):
   ```
   makan siang 50rb
   gaji 5jt
   parkir 5rb sama kopi 18rb
   ```
4. Buat kategori custom kalau default kurang:
   ```
   kategori tambah keluar Jimpitan | jimpitan, infak
   ```
5. Transfer antar akun:
   ```
   transfer 100rb bsi ke gopay
   ```
6. Anggaran (peringatan otomatis 80% / tembus):
   ```
   anggaran Makanan 2jt
   ```
7. Cek laporan / grafik / export:
   ```
   laporan banding
   laporan arus kas 6
   grafik komposisi
   csv
   ```
8. Backup rutin: tombol **⬇ Backup** → file JSON.
9. Atur tampilan (opsional): tombol **🎨** → wallpaper preset atau foto sendiri.
10. Keluar: tidak ada logout. Tutup app/tab. Data aman di perangkat (OPFS).

### Contoh transaksi

Ketik di kolom chat, kirim. Contoh:

```
makan siang 50rb
gaji 5jt
parkir 5rb sama kopi 18rb      → 2 transaksi sekaligus
gopay makan 50rb                → akun di depan
kemarin makan 50rb              → tanggal relatif
3 september jajan 20rb          → tanggal
```

- Nominal: `50rb`, `1,5jt`, `50000`, `45.001.889`.
- Angka dalam kata: `makan lima ribu`.
- Arah otomatis ditebak: kata `terima/masuk/dapat/gaji/bunga` = **masuk**,
  lainnya = **keluar**.

Ketik `help` untuk daftar perintah lengkap.

### Bagikan dari app lain

Kalau Stacker sudah ter-install, menu **Bagikan** di app lain (SMS, WhatsApp,
notifikasi bank) memunculkan **Stacker**. Teks yang dibagikan otomatis masuk ke
kolom chat dan langsung dicatat — praktis untuk menyalin nominal dari notifikasi.

Parser lokal toleran salah ketik ringan (1 huruf, mis. `gojex` → `gojek`), jadi
sebagian besar pesan selesai tanpa AI.

---

## 5. Daftar Perintah

### Akun
```
akun                          → lihat akun + saldo
akun tambah seabank bank saldo 1jt
akun ubah seabank jadi bankjago → ganti nama akun
akun hapus seabank             → tx ikut pindah ke Cash
saldo awal bsi 45.001.889      → set saldo awal
sesuaikan bsi 100jt            → paksa saldo ke nilai nyata
ubah 1 akun bsi                → pindah transaksi #1 ke akun bsi
```

### Saldo
```
saldo                         → total + semua akun
saldo bsi                     → satu akun
```

### Transfer
```
transfer 100rb bsi ke gopay    → 2 baris (keluar bsi + masuk gopay)
```

### Kategori
```
kategori                      → daftar kategori + kata kunci
kategori tambah masuk Bunga | bunga, dividen
kategori tambah keluar Sedekah | sedekah, donasi
kategori tambah keduanya Sedekah | sedekah
kategori sisi Sedekah keduanya
kategori tambahkata Sedekah | infak
kategori hapuskata Sedekah | zakat
kategori ubah Sedekah | sedekah, donasi, zakat
kategori ubah Hiburan jadi HiburanX  → ganti nama (riwayat + anggaran ikut)
kategori hapus Sedekah
```

### Anggaran
```
anggaran                      → lihat semua anggaran
anggaran Makanan 2jt          → set anggaran bulanan
anggaran Makanan 500rb mingguan → set cap mingguan (Senin–Minggu)
anggaran rollover Makanan     → sisa periode lalu menambah/mengurangi limit
anggaran no-rollover Makanan  → matikan rollover
anggaran hapus Makanan        → hapus anggaran
```
Peringatan otomatis muncul saat pemakaian 80% dan saat tembus.

- **Rollover**: carry = batas − pemakaian periode sebelumnya (bisa negatif).
  Limit efektif = `max(0, batas + carry)`, jadi kelebihan bulan lalu
  mengurangi jatah bulan ini.
- Periode anggaran per kategori: `bulanan` atau `mingguan`. Satu kategori
  hanya punya satu anggaran (tidak bisa bulanan + mingguan sekaligus).

### Laporan, grafik, export
```
laporan | laporan september | laporan gopay september
laporan banding [bulan]       → banding vs periode sebelumnya + top perubahan
laporan arus kas 6            → masuk/keluar/net 6 bulan terakhir
laporan top 10 [bulan]        → 10 pengeluaran terbesar
laporan akun bsi [bulan]      → statement satu akun
grafik | grafik september | grafik gopay
grafik komposisi [bulan]      → donut pengeluaran per kategori (SVG)
grafik tren 6                 → bar masuk/keluar 6 bulan (SVG)
csv | csv september | csv gopay
```
Grafik SVG dibuat lokal dari angka di perangkat — tanpa library, tanpa
mengirim data ke pihak ketiga. Transfer antar akun tidak dihitung sebagai
pengeluaran/pemasukan di laporan.

### Cari & lihat
```
cari kopi
cari jimpitan bsi
cari kopi september 50         → 50 = jumlah hasil
lihat 12                       → detail transaksi #12
```

### Utang & piutang
```
utang 100rb ke budi            → saya berutang ke budi
utang ke budi 100rb            → urutan nominal/nama bebas
piutang 50rb dari andi         → andi berutang ke saya
utang | piutang                → daftar + total sisa
bayar utang budi 50rb          → cicil / lunas otomatis
bayar piutang andi 50rb
utang hapus 3                  → hapus catatan #3
```
Ledger utang/piutang **terpisah** dari saldo akun: mencatat utang tidak
mengubah saldo. Pembayaran mengalokasikan ke catatan tertua lebih dulu.

### Kelola transaksi
```
riwayat | riwayat 30           → transaksi terakhir
ubah 3 jadi 60rb               → ubah nominal
hapus 3                        → hapus #3
hapus 24 25                    → hapus beberapa (boleh #24)
undo                           → batalkan aksi terakhir (maks 20 langkah)
berulang listrik 350rb tiap 5  → catat otomatis tiap bulan
berulang                       → daftar transaksi berulang
berulang hapus 1               → hentikan yang #1
reset transaksi                → hapus semua (file backup JSON terunduh otomatis)
```

### AI & lain
```
ai                            → statistik pemakaian AI
ai reset                      → reset hitungan harian AI
pin | pin atur 1234           → kunci layar (4-8 digit)
pin ubah 1234 5678 | pin hapus 1234
backup                        → unduh backup JSON
backup kunci <kata sandi>     → backup terenkripsi (min 8 karakter)
versi                         → versi aplikasi
help                          → daftar perintah
```

---

## 6. AI (Opsional, default mati)

Parser lokal sudah menangani mayoritas. AI hanya dipakai saat pesan ambigu.

1. Ketuk tombol **⚙ AI** di toolbar.
2. Pilih provider:
   - **Gemini** (default) — gratis pakai free tier. Isi API key.
   - **OpenAI-compatible** — Ollama / LM Studio **lokal**. Isi base URL +
     model + key (Ollama lokal tanpa key).
3. Ketuk **Simpan**.

Contoh base URL Ollama lokal: `http://localhost:11434/v1`, model `llama3.2`.

> CSP app hanya mengizinkan koneksi ke Gemini dan `localhost`/`127.0.0.1`.
> Base URL remote (Groq, OpenRouter, dsb.) akan diblokir browser. Pakai
> Ollama/LM Studio lokal supaya data tidak keluar perangkat.

> AI key tersimpan di perangkat kamu (tabel settings), tidak dibundel.
> Pakai Ollama lokal = data keuangan tidak keluar dari perangkat.

---

## 7. Wallpaper Chat

Ketuk **🎨** di toolbar.

- **Preset** — pilih salah satu kotak warna (Default, Teal, Hutan, Laut, Plum,
  Pasir, Malam, Rose). Langsung diterapkan.
- **Gambar sendiri** — pilih foto dari galeri. Gambar dikecilkan otomatis
  (maks 1280 px, JPEG) dan **disimpan di perangkat saja**, tidak dikirim ke
  mana pun.
- **Kegelapan lapisan** — geser slider supaya teks tetap kebaca di atas foto.
- **Hapus wallpaper** — balik ke tampilan default.

Wallpaper bersifat kosmetik: disimpan di penyimpanan browser (localStorage),
tidak ikut file backup, dan tidak mempengaruhi data transaksi.

---

## 8. PIN, Backup & Restore

### Kunci PIN (opsional)

```
pin                     → status kunci
pin atur 1234           → pasang PIN (4-8 digit)
pin ubah 1234 5678      → ganti PIN
pin hapus 1234          → matikan kunci (butuh PIN lama)
```

- App mengunci otomatis setelah **2 menit tanpa aktivitas**, atau begitu app
  ditinggalkan (pindah app / tab disembunyikan).
- Salah PIN 5× → tunggu 30 detik sebelum bisa coba lagi.
- PIN **hanya mengunci tampilan**, bukan mengenkripsi database. Hash PIN
  (PBKDF2-SHA256, 120.000 iterasi + salt) disimpan lokal dan **tidak ikut
  file backup**.
- Lupa PIN? Data tetap ada di perangkat tapi tak bisa dibuka dari app ini.
  Pulihkan dengan **⬆ Restore** file backup di perangkat lain (atau setelah
  instal ulang PWA).

### Backup & restore

- **⬇ Backup** — unduh seluruh data jadi file JSON.
- **⬆ Restore** — unggah file JSON untuk kembalikan/pindah data.
- `backup kunci <sandi>` di chat — backup **terenkripsi** (AES-GCM 256 +
  PBKDF2, minimal 8 karakter). Simpan kata sandinya; tanpa itu file tak bisa
  dibuka. Saat restore, app meminta kata sandi otomatis.

Catatan:
- File backup **tidak memuat API key AI** (aman dibagikan). Key AI yang
  tersimpan di perangkat tetap dipakai setelah restore.
- `reset transaksi` otomatis mengunduh file `backup-pre-reset-*.json` sebelum
  menghapus. Simpan file itu — bisa di-restore lewat tombol **⬆ Restore**.
- Hapus akun tidak menghapus transaksi: transaksinya dipindah ke akun **Cash**
  supaya total saldo tetap sama dengan jumlah saldo akun.
- Transaksi berulang (`berulang ...`) ikut tersimpan di file backup.

### Penyimpanan permanen & auto-backup

Ketuk **ℹ** di toolbar:

- **Penyimpanan permanen** — app meminta `navigator.storage.persist()` saat
  dibuka supaya browser tidak membersihkan data saat storage menipis. Status
  "ya/belum" tampil di modal; kalau "belum", tetap backup rutin.
- **Pemakaian storage** — perkiraan ruang terpakai vs kuota.
- **Auto-backup folder** (Chrome/Edge/Android) — pilih folder sekali; app
  menulis `stacker-auto-YYYY-MM-DD.json` otomatis saat dibuka (sekali per hari)
  dan saat tombol **Backup ke folder sekarang**. Tidak ada data yang dikirim
  ke internet. File ditulis plaintext JSON — kalau perlu terenkripsi, pakai
  `backup kunci <sandi>` manual.
- **Pengingat** — chat menampilkan notice bila belum pernah backup atau backup
  terakhir ≥ 14 hari.
- **Bar "Versi baru tersedia"** — saat service worker memperbarui cache, app
  menampilkan tombol **Muat ulang** (tidak auto-reload supaya ketikan tak hilang).
- **Panel keamanan** — modal **ℹ** juga menampilkan commit SHA build, hash
  bundle SHA-256, host AI yang boleh dihubungi, dan status "data lokal".
- **Tentang** — bagian bawah modal **ℹ** memuat nama app, pembuat
  (Igoon / I Go On), lisensi Apache-2.0, dan tautan kode sumber.

### Verifikasi keamanan (30 detik)

1. DevTools → **Network** → muat ulang: semua request harus same-origin
   (kecuali Gemini kalau AI dinyalakan).
2. Matikan internet → app tetap jalan dan data tetap ada.
3. DevTools → **Application → Storage**: hanya OPFS/IndexedDB/localStorage
   origin ini.
4. Bandingkan **Hash bundle SHA-256** di **ℹ** dengan release notes.

Batas jujur: PIN hanya mengunci tampilan (bukan enkripsi database), dan
service worker bisa memperbarui kode saat rilis baru. Detail model ancaman di
[`SECURITY.md`](SECURITY.md).

### Transaksi berulang

```
berulang                       → daftar
berulang listrik 350rb tiap 5  → otomatis tiap tgl 5
berulang bsi sewa 1,5jt tiap 1 → dengan akun
berulang hapus 2               → hentikan
```

Dicatat otomatis saat app dibuka (dan saat cek saldo). Idempotent — tak akan
dobel di bulan yang sama, dan bulan yang terlewat akan diisi saat app dibuka
lagi. Tanggal dibatasi 1–28 supaya aman di bulan pendek.

Lakukan backup rutin, terutama di iOS (storage bisa kena *eviction*).

---

## 9. Troubleshooting

| Masalah | Solusi |
|---|---|
| Tab kedua error buka database | `opfs-sahpool` = satu tab. Tutup tab lain. |
| iOS < 16.4 gagal buka database | OPFS belum didukung. Update iOS ke 16.4+ atau pakai Android/desktop. |
| Menu "Bagikan ke Stacker" tak ada | Share target hanya Android/ChromeOS/desktop Chrome. Di iOS salin-tempel teks. |
| Tidak bisa install (banner tak muncul) | Pastikan HTTPS/localhost. Chrome butuh icon 192 & 512 (sudah ada). |
| iOS tak muncul "Add to Home Screen" | Pakai Safari, bukan Chrome. |
| Data hilang setelah lama | Restore dari file backup. |
| Muncul bar "Versi baru tersedia" | Ketuk **Muat ulang** untuk memakai versi terbaru (data tidak hilang). |
| Tombol auto-backup folder tak ada | File System Access API hanya Chrome/Edge/Android. Di iOS/Safari pakai **⬇ Backup**. |
| Auto-backup tidak jalan otomatis | Buka **ℹ** → **Pilih folder auto-backup** sekali (izin folder bisa dicabut browser). Tombol **Backup ke folder sekarang** memaksa tulis. |
| AI tidak aktif | Provider Gemini butuh key. Provider OpenAI butuh base URL. |
| AI OpenAI remote (Groq/OpenRouter) gagal | CSP hanya mengizinkan Gemini + `localhost`/`127.0.0.1`. Pakai Ollama/LM Studio lokal. |

---

## 10. Build & Host Sendiri

```sh
cd mobile
npm install
npm run icons      # regenerate ikon PNG (opsional, sudah dicommit)
npm run build      # hasil di dist/
```

Host folder `dist/` di host statis (Netlify, Vercel, GitHub Pages, dsb.).
Manifest + service worker sudah disertakan. Tidak perlu header COOP/COEP
(karena memakai VFS `opfs-sahpool`).
