/* ==========================================================================
   Pencarian customer untuk dropdown keranjang kasir.

   Dipisah dari komponen supaya bisa diuji tanpa browser. Ini bukan
   gaya penulisan: apa yang dikembalikan menentukan APA yang tersimpan ke
   struk, jadi harus bisa dibuktikan dengan test.
   ========================================================================== */

export type SaranCustomer = {
  /** Nama asli — inilah yang disimpan ke struk. */
  name: string;
  /** Nama lain yang biasa diketik kasir. */
  alias: string[];
  /** Ongkos kirim bawaan. 0 berarti belum pernah diisi. */
  ongkir: number;
};

export type CocokCustomer = SaranCustomer & {
  /** Alias yang cocok dengan yang diketik — ditampilkan supaya jelas
      kenapa "Bhas Sari 38" bisa menemukan "Bhaskara sari 38". Tanpa itu
      hasilnya terbaca sebagai tebakan. */
  jejak?: string;
};

/* -------------------------------------------------------------------------
   Menyusun daftar dari data mentah
   ------------------------------------------------------------------------- */

export type AliasCustomer = { customer_id: number; alias: string };

/** Bentuk minimum `Customer` yang dipakai di sini. Dipisah supaya test
    tidak perlu membuat objek Customer lengkap. */
type CustomerMinimum = { id: string; name: string; ongkir: number };

/** Susun daftar saran dari customer + alias.

    Alias dikelompokkan lewat `customer_id`, bukan lewat pencocokan nama.
    Pencocokan nama itu rapuh: "Bhas Sari 38" dan "Bhaskara sari 38" beda
    satu huruf, dan pencocokan longgar bisa menempelkan alias ke customer
    yang kebetulan mirip — setelah itu kasir menyimpan transaksi di
    customer yang salah, dan tidak ada yang mengetahuinya.

    Alias yang induknya sudah dihapus dibuang diam-diam. Itu satu-satunya
    jalan yang dibuat oleh penghapusan customer, dan menampilkannya
    sebagai pilihan berarti kasir bisa membuat customer yang tidak ada. */
export function saranCustomer(
  customers: CustomerMinimum[],
  alias: AliasCustomer[],
  { maks = 400 }: { maks?: number } = {},
): SaranCustomer[] {
  const perCustomer = new Map<number, string[]>();
  for (const a of alias) {
    const arr = perCustomer.get(a.customer_id);
    if (arr) arr.push(a.alias.trim());
    else perCustomer.set(a.customer_id, [a.alias.trim()]);
  }

  /* `id` di UI dibuat dari kolom id numerik (`mapCustomer` → `c<id>`),
     jadi hubungan ke baris aslinya bisa dibaca balik. Kalau format itu
     berubah, customer akan kehilangan aliasnya — bukan error, cuma saran
     yang kurang berguna. */
  const idDari = (id: string): number | null => {
    const m = /^c(\d+)$/.exec(id);
    return m ? Number(m[1]) : null;
  };

  /* Batas di sini longgar (400 dari 327) karena yang tampil di layar tetap
     dipotong 12 baris. Memotong lebih awal di sini justru membuang
     customer dengan nama yang mengandung huruf yang diketik. */
  return customers
    .map((c) => {
      const num = idDari(c.id);
      return {
        name: c.name,
        alias: num !== null ? (perCustomer.get(num) ?? []) : [],
        ongkir: c.ongkir,
      };
    })
    .filter((s) => s.name.trim() !== "")
    .sort((a, b) => a.name.localeCompare(b.name, "id-ID"))
    .slice(0, maks);
}

export function filterSaranCustomer(
  daftar: SaranCustomer[],
  ketik: string,
  maks = 12,
): CocokCustomer[] {
  const q = ketik.trim().toLowerCase();

  const cocok =
    q === ""
      ? daftar.map((c) => ({ ...c }))
      : daftar
          .map((c) => {
            /* Nama asli dulu. Kalau nama sendiri yang cocok, tidak ada
               jejak yang perlu ditampilkan — kasir sudah melihat
               nama yang cocok di depan mata. */
            if (c.name.toLowerCase().includes(q)) return { ...c };
            const jejak = c.alias.find((a) => a.toLowerCase().includes(q));
            return jejak ? { ...c, jejak } : null;
          })
          .filter((x): x is CocokCustomer => x !== null);

  /* Alfabet. Wajib supaya daftar tidak berganti urutan saat kasir
     mengetik satu huruf lagi — perubahan urutan yang tidak menjelaskan
     apa pun membuat orang mengira pencarian-nya rusak. */
  return cocok
    .sort((a, b) => a.name.localeCompare(b.name, "id-ID") || b.ongkir - a.ongkir)
    .slice(0, maks);
}