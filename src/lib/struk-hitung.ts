/* ==========================================================================
   Hitung ulang angka struk setelah item diedit.

   Ini murni: tidak menyentuh jaringan, tidak menyentuh state. Dipisah dari
   lapisan tulis supaya aturanuangnya bisa diuji tanpa database.

   ATURAN YANG SERING SALAH

   `total` bukan jumlah baris item. Yang dihitung adalah:

       total = subtotal - diskon + pajak + ongkir

   Dan `ongkir` TIDAK punya kolom di tabel sales - nilainya diturunkan
   sebagai sisa:

       ongkir = total - subtotal + diskon - pajak

   Akibatnya: kalau `total` dihitung ulang dari jumlah baris item, ongkir
   ikut terhapus. Struk Rp 300.000 dengan ongkir Rp 20.000 jadi
   Rp 280.000, dan kasir mengirim barang gratis karena tidak ada yang
   terlihat salah.

   Jadi saat item diedit, yang boleh berubah hanya `subtotal`. `ongkir`,
   `diskon`, dan `pajak` tetap dikunci di nilai lama, dan `total` dihitung
   ulang dari sana. Ongkos kirim bukan turunan dari isi keranjang.
   */

export type BarisItem = {
  price: number;
  qty: number;
};

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Subtotal dari baris item. Baris qty 0 atau negatif tidak dihitung. */
export function subtotalDariBaris(baris: readonly BarisItem[]): number {
  return baris.reduce((a, b) => {
    const qty = n(b.qty);
    if (qty <= 0) return a;
    return a + n(b.price) * qty;
  }, 0);
}

/**
 * Hitung ulang subtotal dan total setelah item berubah.
 *
 * `ongkir`, `diskon`, `pajak` diambil dari struk yang sudah ada dan
 * diteruskan apa adanya — bukan dihitung ulang dari baris.
 */
export function hitungUlang(
  baris: readonly BarisItem[],
  struk: { diskon?: number; ongkir?: number; pajak?: number },
): { subtotal: number; total: number } {
  const subtotal = subtotalDariBaris(baris);
  const diskon = n(struk.diskon);
  const pajak = n(struk.pajak);
  const ongkir = n(struk.ongkir);
  return { subtotal, total: subtotal - diskon + pajak + ongkir };
}

/**
 * Status lunas setelah total berubah.
 *
 * `paid_amount` tidak ikut diubah — uang yang sudah dibayar customer itu
 * fakta, bukan hasil hitungan. Yang menentukan status adalah apakah total
 * yang baru sudah tertutup oleh uang yang sudah masuk.
 *
 * Total yang turun drastis sehingga `paid_amount` jadi lebih besar dari
 * total tidak otomatis "lunas": selisihnya berarti kasir mengembalikan
 * kembalian, dan itu keputusan kasir, bukan keputusan otomatis. Fungsi ini
 * sengaja mengembalikan `belum` supaya perbedaan itu terlihat, bukan
 * hilang.
 */
export function statusSetelahTotal(total: number, paidAmount: number): "lunas" | "belum" {
  if (total <= 0) return "belum";
  return paidAmount >= total ? "lunas" : "belum";
}