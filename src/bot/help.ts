import { APP_VERSION } from "../version";

export const HELP =
  `Stacker v${APP_VERSION}\n\n` +
  "Catat transaksi:\n" +
  "  makan siang 50rb\n" +
  "  gaji 5jt\n" +
  "  parkir 5rb sama kopi 18rb   (banyak sekaligus)\n" +
  "  gopay makan 50rb            (akun di depan)\n" +
  "  makan 50rb @bca             (akun pakai @; ketik @ untuk saran akun)\n" +
  "  makan 50rb #liburan         (beri #tag lintas kategori; rekap: tag)\n" +
  "  kemarin makan 50rb          (tanggal relatif)\n" +
  "  tgl 3 bayar kos 1jt\n" +
  "  3 september jajan 20rb\n" +
  "  2026-09-03 jajan 20rb       (tanggal ISO)\n" +
  "  terima sedekah 1jt bsi      (arah masuk)\n" +
  "  bsi sedekah 1jt             (arah keluar)\n\n" +
  "Transfer:\n" +
  "  transfer 100rb bsi ke gopay\n" +
  "  transfer 100rb bsi ke gopay biaya 2,5rb\n\n" +
  "Saldo:\n" +
  "  saldo                       (total + semua akun)\n" +
  "  saldo bsi                   (satu akun)\n\n" +
  "Akun:\n" +
  "  akun\n" +
  "  akun tambah seabank bank saldo 1jt\n" +
  "  akun ubah seabank jadi bankjago\n" +
  "  akun hapus seabank\n" +
  "  saldo awal bsi 45.001.889\n" +
  "  sesuaikan bsi 100jt         (paksa saldo ke nilai nyata)\n" +
  "  ubah 1 akun bsi             (pindah tx ke akun)\n\n" +
  "Kategori:\n" +
  "  (arah: terima/masuk/dapat/gaji/bunga = masuk; lain = keluar)\n" +
  "  kategori\n" +
  "  kategori tambah Sosial | sosial, jimpitan, donasi   (default keduanya)\n" +
  "  kategori tambah Sosial sosial jimpitan   (tanpa |, kata pertama = nama)\n" +
  "  kategori tambah masuk Bunga | bunga, dividen\n" +
  "  kategori tambah keluar Sedekah | sedekah, donasi\n" +
  "  kategori sisi Sedekah keduanya\n" +
  "  kategori kelompok Kos kebutuhan   (kebutuhan/keinginan/masa-depan/auto)\n" +
  "  kategori tambahkata Sedekah | infak\n" +
  "  kategori hapuskata Sedekah | zakat\n" +
  "  kategori ubah Sedekah | sedekah, donasi, zakat\n" +
  "  kategori hapus Sedekah      (atau: hapus kategori Sedekah)\n\n" +
  "Laporan & export:\n" +
  "  laporan | laporan september | laporan gopay september\n" +
  "  laporan banding [bulan]      (vs periode sebelumnya)\n" +
  "  laporan arus kas 6           (6 bulan terakhir)\n" +
  "  laporan top 10 [bulan]       (pengeluaran terbesar)\n" +
  "  laporan akun bsi [bulan]\n" +
  "  grafik | grafik september | grafik gopay\n" +
  "  grafik komposisi [bulan] | grafik tren 6\n" +
  "  csv | csv september | csv gopay\n\n" +
  "Anggaran:\n" +
  "  anggaran | anggaran Makanan 2jt | anggaran Makanan 500rb mingguan\n" +
  "  anggaran rollover Makanan | anggaran no-rollover Makanan\n" +
  "  anggaran hapus Makanan\n\n" +
  "Cari & Tag:\n" +
  "  makan 50rb #liburan         (tambahkan #tag di catatan)\n" +
  "  tag | tag #liburan          (daftar tag / rekap per tag)\n" +
  "  cari kopi\n" +
  "  cari jimpitan bsi\n" +
  "  cari kopi september 50          (50 = jumlah hasil)\n" +
  "  lihat 12\n\n" +
  "Kelola:\n" +
  "  riwayat | riwayat 30\n" +
  "  ubah 3 jadi 60rb\n" +
  "  ubah 3 tanggal kemarin | ubah 3 catatan makan siang | ubah 3 kategori Makanan\n" +
  "  hapus 3\n" +
  "  hapus 24 25                 (beberapa sekaligus, boleh #24)\n" +
  "  ubah 24 25 kategori Makanan (edit massal: kategori / akun / tag / hapustag)\n" +
  "  kategori gabung A ke B | akun gabung A ke B | duplikat\n" +
  "  undo                        (batalkan aksi terakhir)\n" +
  "  redo | ulangi               (ulangi aksi yang dibatalkan)\n" +
  "  berulang listrik 350rb tiap 5   (auto tiap bulan)\n" +
  "  berulang | berulang hapus 1 | berulang nonaktif 1 | berulang aktif 1\n" +
  "  berulang ubah 1 400rb tiap 10\n" +
  "  utang 100rb ke budi         (ledger utang/piutang)\n" +
  "  piutang 50rb dari andi\n" +
  "  bayar utang budi 50rb [@bsi] | utang hapus 3 | piutang hapus 4\n" +
  "  target Liburan 5jt [tempo 2027-06-01]   (target / sinking fund)\n" +
  "  target | target isi Liburan 500rb [@bsi] | target ambil Liburan 100rb | target hapus Liburan\n" +
  "  alokasi                     (panduan 50/30/20 bulan ini)\n" +
  "  skor                        (skor kesehatan finansial 0-100)\n" +
  "  pin                         (status kunci; atur lewat ☰ → Keamanan)\n" +
  "  backup | backup kunci <sandi>   (JSON / terenkripsi)\n" +
  "  ai | ai reset               (pemakaian AI)\n" +
  "  versi                       (versi aplikasi)\n" +
  "  reset transaksi            (hapus semua transaksi, ada backup)\n" +
  "  alias | alias tf transfer | alias hapus tf | alias reset\n" +
  "  cls | clear | bersihkan     (bersihkan layar chat)\n" +
  "  help\n\n" +
  "Nominal: 50rb, 1,5jt, 50000, 45.001.889\n" +
  "Periode: september, 2026-08, minggu ini, minggu lalu, bulan lalu, tahun ini, hari ini, kemarin";

