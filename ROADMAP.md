# Roadmap Stacker (mobile)

Prinsip: **lokal dulu, tanpa server, chat-first**. Chat untuk *mencatat*; menu untuk
*mengelola*. Prioritas menyempurnakan sebelum menambah fitur besar.

## Selesai
- 2.9.0 PIN keypad + hapus semua data + sinkron kata perintah
- 2.10.0 Kategori toleran + reset lewat menu
- 2.10.1 Fix chart terpotong
- 2.11.0 Opsi auto-lock PIN, manajemen Kategori/Anggaran, Ringkasan
- 2.11.1 Fix parser (akun vs kata kunci kategori)
- 2.12.0 Samarkan saldo (default tersamar)
- 2.13.0 Akun UI, menu berkelompok, onboarding chip, pengingat in-app
- 2.14.0 Robustness (index DB, periksa integritas data, parser ambigu) + A11y
  dasar + pembeda area scroll + bunyi pengingat "ting"
- 2.15.0 Update transparan (versi + catatan rilis) + feedback menu (toast/inline)
- 2.16.0 cls/clear + riwayat perintah (tombol ↺/panah/saran) + Tentang durasi
  pakai + haptic + undo state + kartu "Hari ini"
- 2.17.0 Integrasi OS: App Shortcuts, Badging API, Install prompt; "Dipakai
  sejak" pindah ke DB (tahan update, tak ikut backup/restore)
- 2.17.1 Fix banner update palsu (banding versi berjalan) + sapaan hanya pengguna baru
- 2.17.2 Update hanya saat dikonfirmasi (SW tanpa skipWaiting + navigasi cache-first)
- 2.17.3 Fix banner update palsu (race: tunggu versi app berjalan diketahui)
- 2.17.4 Fix version.json selalu dari jaringan (info update tampil lagi)
- 2.17.5 Fix atribut hidden (menu Pasang & baris idle tidak selalu tampil)
- 2.18.0 Redo + riwayat perintah + 8 tema warna
- 2.18.1 Backup/restore dipindah ke menu penyimpanan
- 2.18.2 Tema/wallpaper, izin folder tersimpan, undo-redo lebih aman
- 2.18.3 Fix tanggal di awal tak menghalangi perintah (mis. transfer)
- 2.19.0 Header saldo 2 baris (saldo + masuk/keluar bulan) + angka ringkas
- 2.20.0 Menu Berulang (daftar + aktif/nonaktif + ubah + hapus)
- 2.21.0 Menu Utang/Piutang (daftar + bayar + hapus)
- 2.22.0 Menu Cari (kata kunci + akun + kategori + tanggal + nominal)
- 2.22.1 UI menu Info dirapikan (Cari di atas, lebih rapat, daftar scroll)
- 2.22.2 Update lebih cepat (SW updateViaCache none + cek saat dibuka)
- 2.23.0 Auto-kategorisasi on-device (tebak kategori dari riwayat, tanpa AI)
- 2.24.0 Deteksi langganan otomatis (pola bulanan nominal sama → saran berulang)
- 2.25.0 Ringkasan++ (net worth, utang/piutang, proyeksi net, tren 6 bulan)
- 2.26.0 Samarkan nominal transaksi di chat (opt-in)
- 2.26.1 Periksa pembaruan manual + surface SW waiting saat foreground
- 2.27.0 Target & sinking fund (progres, saran/bulan, tempo; isi/ambil/hapus)
- 2.28.0 Panduan alokasi 50/30/20 (perintah `alokasi` + bagian Ringkasan)
- 2.29.0 Tema terang "Langit" (biru) + perbaikan kontras teks tema terang
- 2.30.0 Kartu transaksi di chat + chip perintah cepat
- 2.30.1 Kartu transaksi: hapus duplikasi akun + ikon kategori

## Berikutnya
- Kandidat dari "Nanti": Import CSV bank + auto-kategorisasi, WebAuthn,
  i18n + tema terang, multi-mata uang.

## Nanti
- Import CSV bank + auto-kategorisasi.
- Biometric/passkey (WebAuthn) di samping PIN.
- i18n (EN) + tema terang.
- Multi-mata uang.

## Dijeda / bukan prioritas
- Messaging/walkie-talkie antar-pengguna (tak selaras; biaya besar).
- **"Bagikan objek keuangan"** (mis. split bill → utang otomatis via tautan/QR) —
  ide bagus, tunggu prioritas inti selesai.
- Enkripsi at-rest (SQLCipher) — kompleks, berisiko ke OPFS.

## Kebijakan versi
- MAJOR: perubahan tak kompatibel (skema destruktif, arti saldo berubah).
- MINOR: fitur baru kompatibel.
- PATCH: bugfix.
Tiap rilis: bump `package.json` + `src/version.ts`, commit, mirror ke repo `Stacker`
(`main`), lalu `git tag`.
