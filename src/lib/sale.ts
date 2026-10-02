/* ==========================================================================
   Bentuk struk untuk UI.

   Dipisah dari angka-angka dummy supaya tidak ada tempat lagi yang bisa
   mengimpor data contoh: file ini cuma tipe dan bentuk.
   ========================================================================== */

export type SaleLine = {
  name: string;
  variant: string;
  qty: number;
  price: number;
  /** Catatan dapur untuk baris ini — hanya baris ini yang masuk bagian
      CATATAN ITEM di KOT. */
  note?: string;
};

export type StatusStruk = "lunas" | "belum" | "terhapus";

export type Sale = {
  /** id baris di tabel `sales`. Wajib untuk operasi tulis (hapus/restore
   *  struk): menulis lewat `receipt_no` terlihat aman karena nomor itu unik,
   *  tapi primary key yang benar dan tidak bisa berubah karena salah edit. */
  id: number;
  receiptNo: string;
  customer: string;
  /** Tanggal ISO (YYYY-MM-DD) versi waktu lokal kasir. */
  completedOn: string;
  /** ISO mentah dari server (UTC). Disimpan supaya pengelompokan per jam
      tidak perlu mengurai completedAt yang sudah diformat. */
  completedIso: string;
  completedAt: string;
  total: number;
  payment: string;
  itemCount: number;
  status: StatusStruk;
  address?: string;
  /** Tidak ada kolomnya di database — selalu undefined sampai sumbernya
      ditambahkan. Jangan diisi dari tebakan. */
  courier?: string;
  ongkir?: number;
  diskon?: number;
  lines: SaleLine[];
};

/** Subtotal = jumlah baris item. Total = subtotal − diskon + ongkir. */
export function subtotalStruk(s: Sale): number {
  return (s.lines ?? []).reduce((a, l) => a + l.price * l.qty, 0);
}
