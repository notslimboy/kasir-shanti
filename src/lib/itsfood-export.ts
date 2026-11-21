import { angka } from "./format";
import { bersihkanNamaItem, parseRupiah, type ItsfoodOrder, type ItsfoodOrderDetail } from "./itsfood";
import { selCsv, unduhCsvPenjualan } from "./export-penjualan";

/* ==========================================================================
   Export CSV order ITS Food — satu hari.

   Bentuk tabel: rinci per item, identitas order (pemesan, alamat, jam
   antar, catatan) cuma di baris pertama order itu. Di Excel/Sheets baris
   kosong dibaca sebagai lanjutan blok order, jadi saat di-print tabelnya
   terbaca satu kotak per order — persis yang kasir bawa ke dapur.

   Total memakai angka literal (dihitung di sini), bukan formula =SUM():
   angka harus benar di viewer mana pun, termasuk pratinjau yang tidak
   mengevaluasi formula. Pemisah titik koma mengikuti export-penjualan
   (Excel id-ID) dan unduhCsvPenjualan sudah menambahkan BOM.
   ========================================================================== */

const PEMISAH = ";";

const BULAN = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** "2026-11-09" → "9 Nov 2026" — gaya nama file `Order-tanggal …`. */
export function labelTanggalCsv(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[(m ?? 1) - 1] ?? ""} ${y}`;
}

/** "11:00:00" → "11:00". Jam antar yang kasir dan dapur kenal. */
function jamPendek(iso: string): string {
  return (iso || "").slice(0, 5);
}

export function namaFileCsvItsfood(iso: string): string {
  return `Order-tanggal ITS Food ${labelTanggalCsv(iso)}.csv`;
}

/** Baris item satu order; `[identitas, ...items, total]`.
    Item dan total memakai angka polos ("44.000") supaya bisa dijumlah di
    Excel, bukan teks mata uang. */
function barisOrder(
  order: ItsfoodOrder,
  detail: ItsfoodOrderDetail | undefined,
): { rows: string[][]; total: number } {
  const ident: string[] = [
    detail?.pemesan || order.customer,
    detail?.alamat || order.address,
    jamPendek(order.deliveryTime),
    detail?.catatan ?? "",
  ];
  const kosong = ["", "", "", ""];

  if (!detail) {
    /* Detail gagal/masih dimuat — order tidak boleh hilang diam-diam dari
       file cetakan; kasir harus tahu baris ini baru sebagian. */
    return {
      rows: [
        [...ident, "(detail gagal dimuat — coba muat ulang lalu unduh lagi)", "", "", ""],
      ],
      total: 0,
    };
  }

  const rows: string[][] = [];
  /* Identitas order tampil sekali, di baris item pertama — blok berikutnya
     kosong, dibaca Excel sebagai lanjutan order itu. */
  let kolomIdentitas = ident;
  let total = 0;
  for (const it of detail.items) {
    const subtotal = parseRupiah(it.subtotal) || parseRupiah(it.price) * (Number(it.qty) || 0);
    total += subtotal;
    rows.push([
      ...kolomIdentitas,
      bersihkanNamaItem(it.name),
      it.qty,
      angka(parseRupiah(it.price)),
      angka(subtotal),
    ]);
    kolomIdentitas = ["", "", "", ""];
  }
  rows.push([...kosong, "Total order", "", "", angka(total)]);
  return { rows, total };
}

/** Header + semua baris, berupa teks CSV siap tulis. Fungsi murni: tanpa
    DOM, tanpa download — supaya bisa diuji unit. */
export function teksCsvItsfoodHarian(
  orders: ItsfoodOrder[],
  detailPerId: Record<string, ItsfoodOrderDetail>,
): string {
  const rows: string[] = [
    ["Pemesan", "Alamat", "Jam Antar", "Catatan", "Item", "Qty", "Harga", "Subtotal"].join(PEMISAH),
  ];

  let totalHari = 0;
  for (const order of orders) {
    const { rows: baris, total } = barisOrder(order, detailPerId[order.id]);
    totalHari += total;
    for (const r of baris) rows.push(r.map(selCsv).join(PEMISAH));
  }

  if (orders.length > 0) {
    rows.push(["", "", "", "", "TOTAL HARI", "", "", angka(totalHari)].map(selCsv).join(PEMISAH));
  }

  return rows.join("\n");
}

/** Satu pintu untuk tombol Download CSV harian. Tanpa order, tidak ada
    file yang diunduh dan tombolnya sudah disabled di halaman. */
export function unduhCsvItsfoodHarian(
  tanggalIso: string,
  orders: ItsfoodOrder[],
  detailPerId: Record<string, ItsfoodOrderDetail>,
): { ok: true; namaFile: string } | { ok: false; pesan: string } {
  if (orders.length === 0) {
    return { ok: false, pesan: "Belum ada order pengantaran di tanggal ini." };
  }
  const namaFile = namaFileCsvItsfood(tanggalIso);
  unduhCsvPenjualan(namaFile, teksCsvItsfoodHarian(orders, detailPerId));
  return { ok: true, namaFile };
}
