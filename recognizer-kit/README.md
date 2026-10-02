# Shanti Catering Recognizer Kit

Paket portabel untuk memindahkan perilaku parser order WhatsApp ke AI lain.

## Sumber Aturan

`../instruksi_ai_parser.md` adalah sumber aturan bisnis, sedangkan `../customers.csv` adalah snapshot terstruktur untuk nama customer, alias, tag, dan ongkir. Dokumen dalam folder ini tidak menggantikannya; dokumen ini hanya membuat aturan tersebut lebih mudah dipakai dan diuji oleh model lain.

## Cara Pakai Di AI Lain

1. Berikan isi `SYSTEM_PROMPT.md` sebagai system instruction atau instruksi awal.
2. Berikan `instruksi_ai_parser.md` lengkap dalam konteks yang sama.
3. Berikan menu hari ini, rentang waktu, dan sumber order yang memang diminta pengguna.
4. Bila pengguna memberi screenshot saja, pakai screenshot saja. Jangan membaca file chat lain kecuali diminta secara eksplisit.
5. Minta hasil dengan header CSV yang persis sama, lalu bandingkan dengan `fixtures/evaluation-cases.md` sebelum dipakai untuk order nyata.

## Isi Paket

- `SYSTEM_PROMPT.md`: instruksi siap tempel untuk AI tujuan.
- `OUTPUT_CONTRACT.md`: kontrak input, output, dan aturan validasi.
- `fixtures/evaluation-cases.md`: kasus uji ringkas untuk mengecek perilaku penting.

## Kriteria Lulus Cepat

- Header CSV persis: `customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote`.
- Satu baris untuk satu item dan detail order yang sama diulang pada seluruh item order tersebut.
- `note` hanya untuk kebutuhan dapur per item; `sendNote` hanya untuk kirim, pickup, atau instruksi kurir per customer.
- Customer dan ongkir mengikuti snapshot lokal `customers.csv`; refresh Supabase adalah maintenance terpisah, bukan bagian parsing rutin.
- Urutan order dari chat paling lama ke terbaru, dengan semua baris satu order tetap berdekatan.
- Data yang tidak yakin tidak boleh ditebak; tandai `[PERLU REVIEW]` sesuai aturan utama.
