export const AI_BULK_PROMPT = `Ringkas chat WhatsApp ini menjadi CSV saja, tanpa markdown.
Kolom wajib:
customer,chatDate,payment,ongkir,item,quantity,unit,varian,harga,note,sendNote

Aturan:
- Satu baris = satu item pesanan.
- Ulangi customer, chatDate, payment, dan ongkir untuk item dari customer yang sama.
- customer adalah nama kontak WA yang sudah berisi alamat/patokan pelanggan.
- Jika chat menyebut harga custom seperti "Sop Iga 50K", isi kolom harga dengan 50000 dan item tetap "Sop Iga".
- Jika chat menyebut jumlah satuan seperti "Perkedel 10 biji", isi item "Perkedel", quantity 10, dan unit "biji".
- Jika chat menyebut porsi separuh/setengah/1/2, isi varian "Separuh" dan quantity 1.
- Catatan seperti "sambal pisah", "tidak pakai udang", atau "caonya kotak-kotak" harus masuk ke kolom note pada item yang sesuai.
- Instruksi kirim/pickup seperti "kirim ke Direktorat ITS", "ambil gojek", atau "titip satpam" harus masuk ke kolom sendNote, bukan note.
- Jika ada produk yang sama tetapi memiliki catatan/varian berbeda, produk itu HARUS ditulis sebagai baris terpisah dengan catatan masing-masing. JANGAN menggabungkan kuantitasnya menjadi satu baris.
- Abaikan obrolan yang bukan pesanan, gabungkan revisi terakhir dari customer yang sama, dan jangan menebak item kalau tidak disebut.

Contoh:
customer,chatDate,payment,ongkir,item,quantity,unit,varian,harga,note,sendNote
"Bu Ani - Jl Melati 12","28/5/2026 10.15","Tunai",10000,"Nasi Goreng Rumahan",20,"porsi",,,"sambal pisah untuk 5 porsi","kirim ke pos satpam"`;

/** Tanggal hari ini dalam format Indonesia, mis. "2/10/2026". */
function hariIniID(now = new Date()): string {
  return `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
}

/**
 * Contoh CSV yang dipakai tombol "Isi contoh" di halaman import.
 * Tanggal selalu mengikuti tanggal hari ini supaya contoh tidak terlihat basi.
 */
export function contohCsv(now = new Date()): string {
  const tgl = hariIniID(now);
  return `customer,chatDate,payment,ongkir,item,quantity,note,sendNote
"Bu Ani - Jl Melati 12","${tgl} 10.15","Tunai",10000,"Nasi Goreng Rumahan",20,"sambal pisah","kirim pos satpam"
"Bu Ani - Jl Melati 12","${tgl} 10.15","Tunai",10000,"Nasi Goreng Seafood",5,"tidak pedas","kirim pos satpam"
"Pak Budi - Jl Kenanga 8","${tgl} 12.03","Transfer",15000,"Nasi Goreng Jawa",10,"tidak pakai udang",""
"Pak Budi - Jl Kenanga 8","${tgl} 12.03","Transfer",15000,"Nasi Goreng Kampung",8,"pedas sedang",""`;
}
