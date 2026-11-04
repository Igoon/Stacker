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

## Berikutnya
### v2.14.0 — Robustness & A11y
- Cek integritas data (transfer yatim, kategori kosong, saldo tak konsisten).
- Index DB (`tanggal`, `kategori`, `account_id`) untuk data besar.
- Parser: turunkan confidence saat ambigu (dua kata kunci asli) → fallback AI.
- A11y pass: `aria-label`, urutan fokus & modal, kontras WCAG AA, uji screen reader.

### v2.15.0 — Tuntaskan kelola lewat menu
- Berulang UI (daftar + aktif/nonaktif + ubah).
- Utang/Piutang UI (daftar + bayar + hapus).
- Cari/filter UI (rentang tanggal, nominal, kategori, akun).

## Nanti
- Dashboard++: tren 6 bulan, perbandingan, proyeksi arus kas, *net worth*.
- Auto-kategorisasi on-device (dari riwayat) — tanpa cloud.
- Pendeteksi langganan otomatis (pola nominal + interval → saran `berulang`).
- Goal/sinking fund + template 50/30/20.
- Import CSV bank + auto-kategorisasi.
- Samarkan nominal transaksi di chat (lanjutan saldo tersamar).
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
