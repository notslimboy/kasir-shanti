import { normalizeKey } from "./utils";

/* ==========================================================================
   KOT — Kitchen Order Ticket.

   Port dari app lama (script.js: buildDailyReport + buildKitchenOrderTicket).

   Prinsipnya, dan ini yang menentukan bentuk KOT:

   KOT BUKAN daftar struk. KOT adalah rekap TOTAL PER NAMA MENU untuk satu
   rentang tanggal. Dapur tidak cares customer siapa, tidak cares harga, dan
   tidak cares nomor struk. Yang dibutuhkan cuma: "Nasi Goreng 40x".

   Karena itu KOT memakai date range yang sama dengan filter laporan, bukan
   daftar orderan. Kalau dibuat per order, dapur akan dapat 30 baris "Nasi
   Goreng 2x" alih-alih satu baris "Nasi Goreng 40x".

   Bentuk cetaknya (72mm, dua sisi):
     KOT                 <bold, center>
     30 September 2026   <center>   atau "1 Sep - 30 Sep" kalau rentang
     ----------------
     Ayam Goreng BaPut        12x   <- diurut qty terbesar
     Nasi Goreng             40x
     ----------------
     CATATAN ITEM                 <- hanya kalau ada
     2x Nasi Goreng: sambal pisah
     ----------------
     TOTAL ITEM             128
   ========================================================================== */

export type KotLine = { name: string; variant: string; qty: number; price: number; note?: string };

export type KotItemTotal = { name: string; quantity: number; total: number };

export type KotNote = { name: string; note: string; quantity: number };

export type KotTicket = {
  dateLabel: string;
  itemTotals: KotItemTotal[];
  /** Total seluruh qty — angka di kaki KOT. */
  itemCount: number;
  notedItems: KotNote[];
};

/* lines boleh kosong: struk yang sudah dihapus tidak pernah ikut
   dihitung, dan memfilter di sini lebih murah daripada memfilter nanti. */
export type SaleForKot = {
  lines?: KotLine[];
  /** Struk yang sudah di-void. Opsional supaya pemanggil yang memang tidak
   *  punya kolom status (mis. rekap dari sumber lain) tetap bisa memakai
   *  fungsi ini tanpa harus mengarang nilai. */
  status?: string;
};

/**
 * Nama yang dicetak di KOT. Meniru getReceiptItemDisplayName() di app lama:
 * varian selain "Normal" ikut disebut, karena dapur harus tahu "Separuh"
 * bukan "Normal".
 */
export function namaItemKot(line: KotLine): string {
  const varian = String(line.variant ?? "").trim();
  if (!varian || normalizeKey(varian) === "normal") return line.name;
  return `${line.name} (${varian})`;
}

/** Angka qty dapur: bulat kalau bulat, 2 desimal kalau bukan (mis. 1,5 porsi). */
export function formatQtyDapur(value: number): string {
  const q = Number(value || 0);
  if (!Number.isFinite(q)) return "0";
  if (Number.isInteger(q)) return String(q);
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(q);
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function labelTanggal(d: Date): string {
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

export function labelRentangKot(from: Date, to: Date): string {
  const samaHari =
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate();
  if (samaHari) return labelTanggal(from);
  const Pendek = (d: Date) => `${d.getDate()} ${BULAN[d.getMonth()].slice(0, 3)}`;
  return `${Pendek(from)} - ${Pendek(to)}`;
}

/**
 * Bangun KOT dari sekumpulan struk pada satu rentang tanggal.
 *
 * Urutannya penting dan diwarisi dari app lama:
 *   1. agregasi per nama item (varian sudah ikut jadi bagian nama)
 *   2. hanya quantity > 0 yang ikut
 *   3. urut qty terbesar; seri dipecah total, lalu nama secara locale id-ID
 *   4. catatan digabung per (nama, catatan), diurut nama lalu catatan
 */
export function buildKitchenOrderTicket(
  sales: SaleForKot[],
  from: Date,
  to: Date,
): KotTicket {
  const itemMap = new Map<string, KotItemTotal>();
  const noteMap = new Map<string, KotNote>();
  let itemCount = 0;

  for (const sale of sales) {
    /* Struk yang sudah di-void TIDAK boleh masuk KOT.

       KOT adalah tiket yang dipakai dapur untuk memasak. Kalau struk
       dibatalkan, masakannya harus ikut dibatalkan — kalau tidak, dapur
       masih memasak barang yang tidak ada pelanggannya, dan itu bahan
       yang terbuang.

       Filter ini diletakkan di dalam fungsi, bukan di pemanggil, supaya
       tidak ada pemanggil berikutnya (cetak KOT, rekap mingguan, ekspor)
       yang lupa dan diam-diam membawa struk void ke dapur lagi.

       Dicek dengan `=== "terhapus"` dan bukan `!== "lunas"`: status
       "belum" (belum dibayar) tetap harus dimasak. */
    if (sale.status === "terhapus") continue;
    for (const line of sale.lines ?? []) {
      const name = namaItemKot(line);
      const quantity = Number(line.qty || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;

      itemCount += quantity;
      const current = itemMap.get(name) ?? { name, quantity: 0, total: 0 };
      current.quantity += quantity;
      current.total += Number(line.price || 0) * quantity;
      itemMap.set(name, current);

      const note = String(line.note ?? "").trim();
      if (note) {
        const key = `${normalizeKey(name)}\u0000${normalizeKey(note)}`;
        const n = noteMap.get(key) ?? { name, note, quantity: 0 };
        n.quantity += quantity;
        noteMap.set(key, n);
      }
    }
  }

  return {
    dateLabel: labelRentangKot(from, to),
    itemTotals: [...itemMap.values()]
      .filter((i) => i.quantity > 0)
      .sort(
        (a, b) =>
          b.quantity - a.quantity ||
          b.total - a.total ||
          a.name.localeCompare(b.name, "id-ID"),
      ),
    itemCount,
    notedItems: [...noteMap.values()].sort(
      (a, b) => a.name.localeCompare(b.name, "id-ID") || a.note.localeCompare(b.note, "id-ID"),
    ),
  };
}
