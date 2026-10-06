/* Catatan per item di keranjang kasir.

   Permintaan pelanggan yang tidak bisa ditebak dari nama menu —
   "tanpa sambel", "tanpa lontong", "tambah gekuk" — harus ikut
   dibawa sampai ke struk. Kalau tidak, kasir menulis ulang orderan
   yang sama secara manual.

   Satu catatan berlaku untuk seluruh baris, sama seperti kolom `note`
   pada CSV impor: baris dengan catatan berbeda tetap baris berbeda,
   jadi "2 beef slice, 1 tanpa sambel" ditulis sebagai dua catatan
   pada dua baris terpisah, bukan satu catatan untuk dua item.

   Dua hal dinormalkan di sini, bukan di komponen:

   - spasi di tepi tidak pernah berarti apa-apa, jadi spasi berlebih di
     dalam juga diratakan menjadi satu spasi;
   - baris tanpa catatan tidak menyimpan string kosong. Kolom `note` di
     database dan cetakan struk sama-sama memperlakukan "" sebagai
     "tidak ada", jadi keduanya haruskan sama persis. */

/** Bersihkan input kasir. Mengembalikan undefined kalau tidak ada isi —
    inilah yang membuat "belum ada catatan" bisa dicek tanpa membandingkan
    dengan string kosong. */
export function rapikanCatatan(v: string): string | undefined {
  const s = v.trim().replace(/\s+/g, " ");
  return s === "" ? undefined : s;
}

/** Ringkasan isi baris untuk daftar "Orderan Disimpan".

    Dua baris dengan nama menu sama tapi catatan berbeda harus bisa
    dibedakan dari daftar hold. Tanpa itu kasir tidak tahu hold mana
    yang memuat "tanpa sambel". */
export function ringkasCatatan(
  baris: { name: string; qty: number; note?: string }[],
  fmtQty: (n: number) => string,
): string {
  return baris
    .map((x) => {
      const catatan = rapikanCatatan(x.note ?? "");
      return `${x.name}${catatan ? ` (${catatan})` : ""} ×${fmtQty(x.qty)}`;
    })
    .join(", ");
}