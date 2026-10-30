# Keamanan Stacker

Stacker adalah PWA lokal untuk mencatat keuangan. Tidak ada server, tidak ada
akun, dan data transaksi disimpan di perangkat (OPFS). Dokumen ini menjelaskan
apa yang dijamin, apa yang **tidak** dijamin, dan cara memverifikasi build.

## Model ancaman

Yang dilindungi:
- Data keuangan tidak dikirim ke pihak mana pun secara default.
- Kode yang berjalan tidak boleh memuat script/iframe/objek dari origin lain
  atau menjalankan `eval`.
- Supply chain build (dependency, GitHub Action) diperkecil dan bisa diaudit.

Yang **tidak** dilindungi (batas jujur):
- **Service worker bisa mengganti kode saat update.** Itu sifat PWA. Mitigasi:
  versi, commit SHA, dan hash bundle ditampilkan di modal ℹ; update tidak
  auto-reload; build punya attestation.
- **PIN hanya mengunci tampilan**, bukan mengenkripsi database. Perangkat yang
  tidak terkunci dan dikuasai orang lain bisa membaca OPFS lewat devtools.
- XSS lewat input pengguna belum menjadi fokus (tidak ada konten HTML dari luar).
- Serangan fisik/OS-level, malware perangkat, atau browser yang sudah
  dikompromikan berada di luar cakupan.

## Kontrol yang diterapkan

### Content Security Policy (meta di `index.html`)

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' ws://localhost:* ws://127.0.0.1:*
  https://generativelanguage.googleapis.com
  http://localhost:* http://127.0.0.1:*;
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
```

Efek:
- Tidak ada script remote, `eval`, iframe, atau plugin.
- Koneksi keluar hanya ke Gemini dan `localhost`/`127.0.0.1`. Base URL
  OpenAI-compatible **remote** (Groq, OpenRouter, dsb.) diblokir CSP; pakai
  Ollama/LM Studio lokal. AI default mati.
- `frame-ancestors` tidak berlaku lewat meta; host yang butuh anti-clickjacking
  harus menambah header `Content-Security-Policy: frame-ancestors 'none'`.

### Dependency & supply chain

- Satu dependency runtime: `@sqlite.org/sqlite-wasm`, versi dipin persis.
- Tanpa analytics, CDN, font eksternal, atau remote config.
- Fetch di kode hanya di `src/ai.ts` (Gemini + `{base}/chat/completions`).
- Service worker hanya menangani aset same-origin.
- GitHub Actions dipin ke commit SHA. Workflow deploy membangun `dist/` lalu
  membuat build provenance attestation.

## Verifikasi build

Di modal **ℹ**:
- `Build`: commit SHA (dari CI) + tanggal build.
- `Hash bundle SHA-256`: hash modul utama yang sedang berjalan.
- `Host AI`: host yang boleh dihubungi menurut konfigurasi saat ini.

Cocokkan hash dengan release notes/tag. Build dari source:

```sh
npm ci
npm run build
```

`npm ci` memakai lockfile; hash `dist/assets/*.js` seharusnya sama untuk input
yang sama (kecuali metadata build seperti tanggal).

Verifikasi attestation (butuh `gh`):

```sh
gh attestation verify <artifact> --repo Igoon/Stacker
```

## Tes cepat (30 detik)

1. DevTools → **Network** → reload: semua request same-origin (kecuali AI bila
   dinyalakan).
2. Matikan internet → app tetap jalan dan data tetap ada.
3. DevTools → **Application → Storage**: hanya OPFS/IndexedDB/localStorage
   origin ini.
4. Bandingkan **Hash bundle** di ℹ dengan release notes.

## Yang sengaja tidak dilakukan

Analytics, remote config, CDN, `eval`, izin kamera/kontak/lokasi, fetch ke host
tak dikenal, auto-update tanpa pemberitahuan.

## Melaporkan masalah

Buka issue di <https://github.com/Igoon/Stacker/issues> (jangan menyertakan data
keuangan atau kunci API). Untuk laporan sensitif, hubungi pemelihara lewat
profil GitHub.
