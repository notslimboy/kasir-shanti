# Output Contract

## Input Minimum

Recognizer menerima:

- Menu hari ini, termasuk nama resmi item dan harga bila tersedia.
- Sumber order yang dibatasi pengguna: teks WhatsApp, screenshot, atau file chat yang secara eksplisit diminta.
- Rentang waktu bila order perlu difilter.
- Informasi stok khusus bila ada.

Gunakan `instruksi_ai_parser.md` untuk aturan parsing dan `customers.csv` untuk mapping customer, alias, tag, serta ongkir. Snapshot customer dipakai langsung; jangan melakukan sync jaringan sebagai bagian dari parsing rutin.

## Skema CSV

| Kolom | Isi |
| --- | --- |
| `customer` | Nama customer resmi/aman beserta alamat sesuai aturan mapping. |
| `chatDate` | Timestamp chat: `dd/mm/yyyy HH.MM.SS`. |
| `payment` | Kosong secara default. |
| `ongkir` | Bilangan rupiah tanpa `Rp` dan tanpa titik. |
| `item` | Nama menu resmi, persis sama dengan menu hari ini. |
| `quantity` | Bilangan jumlah order/porsi. |
| `harga` | Harga custom hanya bila ada; kosong untuk harga menu normal. |
| `note` | Catatan dapur yang hanya berlaku pada item di baris itu. |
| `sendNote` | Instruksi pengiriman/pickup yang berlaku untuk seluruh order customer itu. |

## Validasi Sebelum Mengirim

1. Header hanya sekali dan berurutan persis seperti kontrak.
2. Semua order berada dalam rentang waktu yang diminta.
3. Item hasil match memakai casing dan ejaan menu hari ini secara persis.
4. Tidak ada alamat/keterangan kurir yang tertinggal di `note`.
5. Tidak ada instruksi dapur yang bocor ke `sendNote`.
6. Jika item sama memiliki note berbeda, setiap variasi memiliki baris sendiri.
7. Tidak ada order ganda dari pesan kirim ulang tanpa penambahan.
8. Kelompok order tersusun paling lama ke terbaru; timestamp kosong berada paling akhir dan diberi laporan review.
9. Bila stok terbatas, item yang tidak kebagian tidak dimasukkan ke CSV dan dicantumkan di laporan terpisah bila diminta.

## Escape CSV

Gunakan nilai kosong untuk data yang tidak ada. Jika suatu nilai mengandung koma, tanda kutip, atau baris baru, kutip nilai tersebut dengan format CSV standar. Untuk `note` dan `sendNote`, lebih baik normalisasikan koma menjadi titik koma sesuai instruksi utama.
