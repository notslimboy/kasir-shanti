/* ==========================================================================
   Bentuk struk untuk UI.

   Dipisah dari angka-angka dummy supaya tidak ada tempat lagi yang bisa
   mengimpor data contoh: file ini cuma tipe dan bentuk.
   ========================================================================== */

export type SaleLine = {
  /** id baris di tabel `sale_items`. PATCH butuh primary key, dan
      mencocokkan baris lewat nama + varian tidak aman — satu menu bisa muncul
      dua kali dalam struk yang sama dengan varian berbeda, dan begitu
      namanya diedit keduanya bisa sama persis.
      Opsional supaya fixture dan data yang belum bersumber dari server tetap
      bisa dipakai; `ubahStruk` menolak baris tanpa id, bukan menebak. */
  id?: number;
  name: string;
  variant: string;
  qty: number;
  price: number;
  /** Catatan dapur untuk baris ini — hanya baris ini yang masuk bagian
      CATATAN ITEM di KOT, dan dicetak sebagai catatan item di struk. */
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
  /** Penuh: "6 Oktober 2026, 09:49". Dipakai tabel dan laporan. */
  completedAt: string;
  /** Ringkas: "6 Okt 09:49". Untuk kartu di layar sempit, tempat label
      penuh terpotong dan tanggalnya justru hilang. */
  completedAtShort: string;
  total: number;
  payment: string;
  itemCount: number;
  status: StatusStruk;
  address?: string;
  /** Kolom `sales.send_note` — dicetak struk sebagai "CATATAN KIRIM".
      This is what the receipt reads, not `address`: a customer address never
      reaches the paper, so editing it here only produces data that appears
      nowhere. */
  sendNote?: string;
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
