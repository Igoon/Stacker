# Duit Bot — Panduan Instalasi & Penggunaan

Duit Bot versi PWA (Progressive Web App). Berjalan penuh di browser, data
keuangan tersimpan **lokal di perangkat kamu** (SQLite + OPFS). Tanpa server,
tanpa akun, tanpa kirim data ke luar. Bisa dipasang seperti aplikasi biasa.

---

## 1. Syarat

- Buka lewat **HTTPS** atau **localhost**. `http://` biasa tidak jalan (OPFS
  butuh secure context).
- **Satu tab saja**. Tab kedua akan gagal buka database. Tutup tab lama dulu.
- iOS minimal 15.2.

---

## 2. Cara Install

### Android — Chrome (paling umum)

1. Buka URL aplikasi di Chrome.
2. Tunggu sebentar, muncul banner **"Tambahkan Duit Bot ke layar utama"**
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
2. Pilih **Uninstall Duit Bot** / **Hapus**.

> **Penting:** Uninstall = data lokal hilang. Ekspor dulu lewat tombol
> **⬇ Backup** kalau data mau dipindah/disimpan.

---

## 4. Penggunaan Dasar

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

---

## 5. Daftar Perintah

### Akun
```
akun                          → lihat akun + saldo
akun tambah seabank bank saldo 1jt
akun hapus seabank
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
kategori hapus Sedekah
```

### Anggaran
```
anggaran                      → lihat semua anggaran
anggaran Makanan 2jt          → set anggaran bulanan
anggaran hapus Makanan        → hapus anggaran
```
Peringatan otomatis muncul saat pemakaian 80% dan saat tembus.

### Laporan, grafik, export
```
laporan | laporan september | laporan gopay september
grafik | grafik september | grafik gopay
csv | csv september | csv gopay
```

### Cari & lihat
```
cari kopi
cari jimpitan bsi
cari kopi september 50         → 50 = jumlah hasil
lihat 12                       → detail transaksi #12
```

### Kelola transaksi
```
riwayat | riwayat 30           → transaksi terakhir
ubah 3 jadi 60rb               → ubah nominal
hapus 3                        → hapus #3
hapus 24 25                    → hapus beberapa (boleh #24)
reset transaksi                → hapus semua (auto backup dulu)
```

### AI & lain
```
ai                            → statistik pemakaian AI
ai reset                      → reset hitungan harian AI
versi                         → versi aplikasi
help                          → daftar perintah
```

---

## 6. AI (Opsional, default mati)

Parser lokal sudah menangani mayoritas. AI hanya dipakai saat pesan ambigu.

1. Ketuk tombol **⚙ AI** di toolbar.
2. Pilih provider:
   - **Gemini** (default) — gratis pakai free tier. Isi API key.
   - **OpenAI-compatible** — Ollama lokal / Groq / OpenRouter. Isi base URL +
     model + key (Ollama lokal tanpa key).
3. Ketuk **Simpan**.

Contoh base URL Ollama lokal: `http://localhost:11434/v1`, model `llama3.2`.

> AI key tersimpan di perangkat kamu (tabel settings), tidak dibundel.
> Pakai Ollama lokal = data keuangan tidak keluar dari perangkat.

---

## 7. Backup & Restore

- **⬇ Backup** — unduh seluruh data jadi file JSON.
- **⬆ Restore** — unggah file JSON untuk kembalikan/pindah data.

Lakukan backup rutin, terutama di iOS (storage bisa kena *eviction*).

---

## 8. Troubleshooting

| Masalah | Solusi |
|---|---|
| Tab kedua error buka database | `opfs-sahpool` = satu tab. Tutup tab lain. |
| Tidak bisa install (banner tak muncul) | Pastikan HTTPS/localhost. Chrome butuh icon 192 & 512 (sudah ada). |
| iOS tak muncul "Add to Home Screen" | Pakai Safari, bukan Chrome. |
| Data hilang setelah lama | Restore dari file backup. |
| AI tidak aktif | Provider Gemini butuh key. Provider OpenAI butuh base URL. |

---

## 9. Build & Host Sendiri

```sh
cd mobile
npm install
npm run icons      # regenerate ikon PNG (opsional, sudah dicommit)
npm run build      # hasil di dist/
```

Host folder `dist/` di host statis (Netlify, Vercel, GitHub Pages, dsb.).
Manifest + service worker sudah disertakan. Tidak perlu header COOP/COEP
(karena memakai VFS `opfs-sahpool`).
