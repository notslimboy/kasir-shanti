# Evaluation Cases

Gunakan kasus sintetis ini untuk membandingkan AI tujuan sebelum ia mengolah order asli. Nama menu di bawah dianggap sebagai menu hari ini.

## Kasus 1: Pisahkan Note Dapur dan Send Note

**Input**

```text
Kirana 4, 20/07/2026 05.20
Tahu Kocek 1 pedas sedang
Tahu Kocek 1 pedas dikit tanpa kubis
Kirim ke Direktorat ITS
```

**Ekspektasi penting**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Kirana 4,20/07/2026 05.20.00,,0,Tahu Kocek,1,,pedas sedang,kirim ke Direktorat ITS
Kirana 4,20/07/2026 05.20.00,,0,Tahu Kocek,1,,pedas dikit tanpa kubis,kirim ke Direktorat ITS
```

Dua variasi tidak boleh digabung. `Kirim ke Direktorat ITS` tidak boleh masuk ke `note`.

## Kasus 2: Pickup Adalah Send Note

**Input**

```text
Raka 22, 20/07/2026 06.10
Buntil 2
Kolak 1
Diambil gojek
```

**Ekspektasi penting**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Raka 22,20/07/2026 06.10.00,,0,Buntil,2,,,diambil gojek
Raka 22,20/07/2026 06.10.00,,0,Kolak,1,,,diambil gojek
```

## Kasus 3: Paket Menu Bukan Kuantitas

**Menu hari ini**: `Sate Usus / 3`

**Input**

```text
Sari 8, 20/07/2026 06.30
Sate usus 2
```

**Ekspektasi penting**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Sari 8,20/07/2026 06.30.00,,0,Sate Usus / 3,2,,,
```

Jumlah tetap `2`, bukan `6`; suffix `/ 3` wajib dipertahankan pada nama item.

## Kasus 4: Tambahan Bukan Duplikasi

**Input**

```text
Nara 11, 20/07/2026 05.40
Kolak 1

Nara 11, 20/07/2026 06.00
Tambah kolak 2
```

**Ekspektasi penting**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Nara 11,20/07/2026 06.00.00,,0,Kolak,3,,,
```

Timestamp order gabungan memakai pesan tambahan paling akhir.

## Kasus 5: Resend Tidak Boleh Menggandakan

**Input**

```text
Reni 5, 20/07/2026 05.40
Pepes Bandeng 1

Reni 5, 20/07/2026 06.00
Pepes Bandeng 1
```

**Ekspektasi penting**: hanya satu baris `Pepes Bandeng` jumlah `1`, dengan timestamp `20/07/2026 06.00.00`.

## Kasus 6: Urutan CSV

Order `20/07/2026 19.10` harus berada di atas order `21/07/2026 05.30`. Jangan mengurutkan berdasarkan nama customer atau berdasarkan posisi screenshot.
