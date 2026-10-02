# Instruksi AI Parser Order WhatsApp

Dokumen ini adalah sumber aturan utama untuk mengubah order Shanti Catering dari
WhatsApp menjadi CSV kasir. Daftar customer tidak disimpan di dokumen ini:
`customers.csv` adalah snapshot lokal terstruktur yang langsung dipakai saat
parsing. Supabase adalah sumber upstream untuk maintenance data customer.

> Handoff AI: baca dokumen ini, `_forAI/PARSER_RUNTIME_COMPACT.md`, dan
> `_forAI/ORDER_PARSING_GUARDRAILS.md`. Untuk evaluasi recognizer gunakan
> `recognizer-kit/fixtures/evaluation-cases.md`.

## Prompt Minimum

User cukup memberi rentang lengkap dan menu:

```text
Pakai instruksi_ai_parser.md.
Cek Chat1.txt dan Chat2.txt dari 25 Jul jam 19:00 sampai 26 Jul jam 12:00.

Menu hari ini:
- Menu A - 35000
- Menu B - 5000 - stok 15

Buat CSV baru dan sort ascending.
```

Agent tidak boleh meminta user menjalankan command. Agent menjalankan seluruh
preflight, audit, dan QA sendiri.

## Alur Wajib

Prinsip hemat token: **Python menyaring dan menyusun; AI mengaudit dan
merapikan.** Agent dilarang memasukkan `Chat1.txt` atau `Chat2.txt` utuh ke
konteks model. Dua file mentah hanya dibaca oleh script lokal.

1. Kunci scope: instruksi terbaru user, mode output, target file, waktu awal dan
   akhir inklusif, menu, stok, serta sumber screenshot bila diminta.
2. Gunakan `customers.csv` yang sudah ada secara langsung. Parsing rutin tidak
   boleh menjalankan sinkronisasi Supabase atau menunggu jaringan.
   `update_customers_csv.py` hanya dijalankan sebagai maintenance terpisah secara
   berkala atau saat user eksplisit meminta refresh data customer.
3. Jalankan `scripts/prepare_order_parse_context.py` untuk menggabungkan,
   deduplikasi, dan memotong `Chat1.txt` + `Chat2.txt` sesuai waktu.
4. Audit `customer-terdeteksi.csv`, `hasil-parser.csv`, dan `review.md`, lalu
   gunakan `chat-range.txt` yang sudah terpotong untuk verifikasi bukti. Baca
   bagian relevan terlebih dahulu; jangan kembali membaca dua chat mentah.
   File kandidat bukan order final.
5. AI merapikan order, tambahan, revisi, pembatalan, catatan, pengiriman,
   payment, customer, ongkir, serta stok terbatas.
6. Lakukan QA lengkap, baru keluarkan atau tulis CSV final.

Bundle kerja berada di `orderan/hasil-parser/<rentang tanggal>/` dan tidak boleh
mengubah CSV order final. File utamanya:

- `chat-range.txt`: semua bukti chat dalam rentang.
- `hasil-parser.csv`: kandidat item, qty, catatan, customer, dan ongkir.
- `customer-terdeteksi.csv`: satu baris per sender yang punya kandidat item.
- `review.md`, `menu.csv`, dan `run.json`.
- `catatan-susulan.csv` atau `stok-terbatas.csv` hanya bila relevan.

## Sumber dan Scope

- `Chat1.txt` dan `Chat2.txt` wajib diperiksa sebagai satu kronologi. Jika salah
  satu hilang, kosong, atau tidak terbaca, jangan finalisasi.
- Hanya pesan dalam timestamp awal-akhir inklusif yang boleh masuk.
- `Hari Ini`, `Kemarin`, judul grup, atau nama file bukan timestamp order.
- Sender `Shanti Catering`/`Santi Catering` adalah akun toko. Jangan jadikan
  customer atau order; pesannya hanya bukti menu, stok, koreksi, dan sold-out.
- Bersihkan tag ekspor seperti `gambar tidak disertakan`, tetapi jangan membuang
  item order lain pada pesan yang sama.
- Pesan separator admin yang hanya berisi garis/underscore/tanda sama dengan
  diabaikan seluruhnya.
- Screenshot/direct text hanya menjadi sumber bila user menyuruh memasukkannya.
  Jangan mengambil chat lain yang kebetulan terlihat.
- Jangan menciptakan timestamp. Order tanpa waktu valid ditaruh setelah order
  bertimestamp dan ditandai untuk review.

## Customer, Alamat, dan Ongkir

Untuk parsing, `customers.csv` adalah referensi aktif nama, alias, tag, dan
ongkir. Supabase adalah upstream yang memperbarui snapshot itu lewat maintenance
terpisah; `kasir-bento.sqlite3` hanya untuk lookup selektif. Jika sumber
bertentangan, jangan memilih diam-diam; gunakan `[PERLU REVIEW]` atau tanya user.

- Alamat adalah identitas unik. Match hanya jika nama/alias sender cocok persis
  atau frasa alamat lengkap cocok persis dengan `customers.csv`.
- Semua token lokasi bermakna, terutama blok, gang, jalan, dan nomor rumah,
  harus sesuai. Dilarang fuzzy-match dari satu angka atau kata yang mirip.
- Contoh larangan: `Pantai Mentari SF 9` tidak boleh menjadi `ITS U 9`; `H 18`
  tidak boleh menjadi `Villa Royal C4/18`; `Tohir 23` tidak boleh menjadi
  `BPD B/23`; `Sutorejo 2/6` tidak boleh menjadi `Kalijudan 2/6`.
- `customer-terdeteksi.csv` berstatus aman hanya untuk
  `UNIQUE_STRICT_MATCH_AI_CONFIRM`. Status `UNMATCHED_AI_REVIEW` atau
  `AMBIGUOUS_EXACT_AI_REVIEW` wajib ditinjau, bukan dipaksa.
- Customer aman ditulis memakai nama kanonik dari `customers.csv`; ongkir dan
  tag juga diambil dari baris yang sama. Ongkir kosong hanya untuk review.
- Jangan gabungkan dua sender berbeda walau alamatnya mirip.
- Jika sender terdaftar meminta kirim ke alamat lain, `customer` tetap profil
  resmi dan tujuan alternatif masuk `sendNote` pada semua item order.

### ITS dan Kasus Khusus

- Alamat blok ITS yang jelas dinormalisasi ke `ITS <BLOK> <NOMOR>`; separator
  `/`, `-`, spasi, dan kata `Blok` boleh dianggap setara hanya bila huruf dan
  seluruh angka sama.
- Jangan membuat format blok ITS untuk nama orang/departemen tanpa blok+nomor
  yang jelas. Gunakan alias resmi atau review.
- Alias resmi: `Alfita/Alftita` -> `ITS T 71`; `Catur SPKB` -> `ITS W 20`;
  `Gatot` -> `ITS T 29`; `J5 Endah` -> `ITS J 5`; `N11 Tanti` -> `ITS N 11`;
  `Yulfi` -> `ITS T 99`; `X 26 Bu Iis` -> `ITS X 26`.
- `ITS D 19`/`SDMO Teknik`: customer `ITS D 19`; tujuan `SDMO` masuk
  `sendNote` bila disebut.
- `ITS D 24` berbeda dari `BPD D 24/25`. Pilih BPD hanya bila `BPD` atau rentang
  `24/25` disebut jelas.
- `WPT IX/JJ-37` adalah Wisper, bukan ITS.
- `Emi Bumi Marina`: tujuan Teknik Fisika memakai ongkir `5000`; tujuan Bumi
  Marina memakai `15000`. Tujuan masuk `sendNote`; jika tidak jelas, review.

## Item, Quantity, dan Konsolidasi

- `item` harus sama persis dengan nama Menu Hari Ini, termasuk kapitalisasi,
  spasi, dan suffix paket seperti `/ 3` atau `/ 20 bj`.
- Angka suffix paket adalah isi satu porsi, bukan quantity. `Ayam / 3` yang
  dipesan dua berarti item `Ayam / 3`, quantity `2`.
- Menu yang ejaannya mirip tetapi berbeda makanan tidak boleh disamakan, contoh
  `Mendoan` dan `Mendol`. Item tidak pasti menjadi `[PERLU REVIEW] <raw item>`.
- Item jelas tanpa qty berarti `1`. Quantity harus numerik.
- Setengah porsi memakai variant resmi bila tersedia; bila tidak, gunakan item
  penuh, quantity `0.5`, dan note `setengah porsi` bila perlu.
- Variant `Jumbo` hanya digunakan bila ada di menu; jika tidak, tulis
  `porsi jumbo` di `note`.
- Item sama dengan note berbeda harus menjadi baris terpisah. Bila note hanya
  berlaku untuk sebagian qty, pecah qty menjadi baris yang tepat.
- Resend identik tanpa kata tambah/revisi bukan order kedua.
- Tambahan/revisi dari sender sama digabung ke satu order. Jumlahkan item yang
  sama hanya bila note sama. Gunakan timestamp pesan order terakhir yang
  diterima sebagai `chatDate` grup.
- Pembatalan dan koreksi mengalahkan pesan awal.
- Pesan implisit seperti `ini 2` harus dilacak ke reply/konteks terdekat. Jika
  dua item sama-sama mungkin, review; jangan menebak.
- Follow-up `tidak pedas`, `kuah banyak`, `paha`, dan sejenisnya hanya menempel
  pada item paling dekat dan kompatibel dari sender yang sama, bukan semua item.

## Note, Send Note, Payment, dan Harga

- `note`: instruksi dapur per item, misalnya `tidak pedas`, `kuah banyak`,
  `paha`, `sambal dipisah`. Jangan taruh alamat di sini.
- `sendNote`: tujuan, kurir, pickup, atau instruksi antar, misalnya `diambil`,
  `GOJEK`, `titip satpam`, atau `kirim ke Teknik Fisika`. Ulangi pada semua
  item dalam order yang sama.
- Pisahkan koma pada note/sendNote dengan semicolon atau gunakan quoting CSV
  yang benar agar kolom tidak bergeser.
- `payment` kosong kecuali ada konfirmasi eksplisit untuk order yang sama:
  `Transfer`, `QRIS`, atau `Tunai`.
- `harga` kosong untuk harga menu normal. Isi hanya jika customer memberi harga
  manual/custom yang memang harus dipertahankan.

## Stok Terbatas dan Menu Tambahan

- Catat requested qty, timestamp aktual, customer, konfirmasi, penolakan,
  pembatalan, allocated qty, dan sisa untuk setiap item terbatas.
- Menu tambahan baru tersedia sejak timestamp pengumuman resmi akun toko.
  Request sebelum waktu itu tidak masuk antrean.
- Setelah AI menyelesaikan identitas, revisi, dan pembatalan, gunakan
  `scripts/allocate_limited_stock.py` untuk FIFO deterministik.
- Alokasi sebagian wajib: `allocated = min(requested, remaining)`.
- Bukti eksplisit `habis`, `tidak kebagian`, atau satu customer memborong sisa
  mengalahkan asumsi FIFO mentah. Jangan output item yang tidak terpenuhi.
- Jangan mengarang penerima untuk sisa stok. Laporkan penerima, tidak kebagian,
  total allocated, dan remaining.

## Mode Tulis dan Format CSV

Header wajib dan urutannya tepat:

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
```

- Satu item = satu baris. Ulangi customer, chatDate, payment, ongkir, dan
  sendNote untuk semua item dalam order yang sama.
- Format waktu: `dd/mm/yyyy HH.MM.SS` dengan tahun empat digit.
- Sort grup order ascending berdasarkan timestamp order terakhir; semua item
  satu order harus tetap berurutan.
- `code block/format saja`: jangan membuat file.
- `buat CSV baru`: buat file baru di `orderan/`, jangan sentuh file mirip.
- `tambahin/append`: simpan semua baris lama, tambahkan hanya baris terverifikasi,
  lalu sort jika diminta. Catat jumlah baris sebelum dan sesudah.
- Replace/overwrite hanya jika user menyebutnya eksplisit.
- Nama file: `Order-tanggal 4 Jul 2026.csv` atau
  `Order-tanggal 3 - 4 Jul 2026.csv`.

## QA Gate Sebelum Final

Jangan finalisasi sampai semua pemeriksaan berikut lolos:

1. Kedua chat dibaca dalam range inklusif yang benar; tidak ada order di luar
   range, order terlewat, atau duplikat.
2. Setiap sender order tercantum di `customer-terdeteksi.csv`; alamat, seluruh
   angka lokasi, customer resmi, dan ongkir sesuai atau jelas ditandai review.
3. Setiap item sama persis dengan menu, suffix paket terjaga, qty numerik, serta
   note/sendNote terpasang ke item/order yang tepat.
4. Tambahan, revisi, pembatalan, resend, dan timestamp grup sudah benar.
5. Total alokasi stok tidak melebihi stok dan semua keputusan punya bukti.
6. CSV memiliki tepat 9 kolom dan dapat dibaca dengan modul `csv`.
7. Untuk append, tidak ada baris lama hilang dan kenaikan row count sama dengan
   rencana penambahan.

Jika ada satu konflik yang belum terselesaikan, hentikan write dan gunakan
`[PERLU REVIEW]` atau tanya user. Kesalahan alamat lebih buruk daripada menahan
satu order untuk review.
