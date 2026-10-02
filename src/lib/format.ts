/* ==========================================================================
   Format angka & tanggal.

   Semua angka rupiah di app ini memakai "+" Rp dan pemisah ribuan id-ID,
   dengan tabular-nums supaya kolomnya rata. Tidak ada format lain — kalau
   ada tempat yang menulis "Rp 88 rb" sementara yang lain "Rp 88.000", angka
   yang sama terlihat berbeda.
   ========================================================================== */

const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** Rp 256.000 */
export const rupiah = (n: number) => RUPIAH.format(Number(n || 0));

const RINGKAS = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Rp 4,2 jt — untuk kartu KPI yang space-nya sempit. */
export const rupiahShort = (n: number) => {
  const v = Number(n || 0);
  return v >= 1_000_000 ? `Rp ${RINGKAS.format(v / 1_000_000)} jt` : `Rp ${RINGKAS.format(v)}`;
};

/** 1,5 — untuk qty yang bisa pecah (mis. 1,5 porsi). */
export const angka = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n || 0));

/* -------------------------------------------------------------------------
   Input angka dengan pemisah ribuan.

   `type="number"` bawaan browser tidak bisa menampilkan pemisah ribuan,
   padahal input seperti ongkir harus bisa membacanya sendiri. Kasir
   mengetik 25000 lalu melihat "25000" tidak tahu itu 25 ribu atau 25 juta —
   salah ketik satu angka berarti ongkir 10x lipat. Dengan pemisah ribuan
   yang muncul sambil mengetik, angkanya enak dibaca tanpa tombol tambahan.
   ---------------------------------------------------------------------- */

const RIBUAN = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** 250000 → "250.000". Nol dan kosong tetap kosong supaya placeholder "0"
    kelihatan dan kotak tidak berisi "0" yang perlu dihapus dulu. */
export function formatRibuan(n: number): string {
  const v = Number(n || 0);
  return v > 0 ? RIBUAN.format(v) : "";
}

/** Teks bebas → angka. Titik, koma, spasi, dan "Rp" diabaikan supaya
    menyalin dari struk atau mengetik "25.000" keduanya diterima. Koma desimal
    dibaca sebagai pemisah ribuan saja: untuk rupiah tidak ada sen. */
export function parseRibuan(teks: string): number {
  const bersih = String(teks ?? "").replace(/[^\d]/g, "");
  if (!bersih) return 0;
  return Number(bersih);
}
