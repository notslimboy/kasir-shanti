import { subtotalStruk, type Sale, type SaleLine } from "./sale";

/* ==========================================================================
   Export CSV transaksi penjualan.

   Bentuk file sengaja mengikuti exportSales() di script.js lama: pemisah
   titik koma dan satu baris per ITEM, bukan per struk. Excel Windows punya
   koma sebagai pemisah desimal, jadi file yang dipisah koma akan membuka
   semua angka jadi satu kolom. Nomor struk yang sama muncul di beberapa
   baris — itu memang yang dipakai pembukuan lama, bukan bug.

   Yang tidak ikut diekspor: struk berstatus "terhapus". Void sudah
   dikeluarkan dari omset di seluruh halaman ini, jadi ikut masuk ke
   laporan berarti supervisor sedang baca angka yang tidak berlaku.
   ========================================================================== */

/** Pemisah kolom. Titik koma = Excel id-ID. */
const PEMISAH = ";";

/** Sel yang berisi `"`, `;`, atau newline harus diapit tanda kutip — nama
    item dan catatan dapur bebas memuat koma, bahkan tanda kutip. */
export function selCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** "Paket 500" dari varian — baris tanpa varian tidak perlu empty cell. */
function namaItem(l: SaleLine): string {
  const v = (l.variant ?? "").trim();
  return v ? `${l.name} (${v})` : l.name;
}

export type OpsiExportCsv = {
  /** Struk yang sudah difilter halaman (rentang + customer + status). */
  struk: Sale[];
  /** Label rentang, dipakai untuk nama file. */
  labelRentang: string;
};

/** Header + baris item, sudah berupa teks CSV siap tulis.
    Fungsi murni: tanpa DOM, tanpa download — supaya bisa diuji. */
export function teksCsvPenjualan(struk: Sale[]): string {
  const rows: string[] = [
    [
      "Nomor Struk",
      "Tanggal",
      "Customer",
      "Alamat",
      "Pembayaran",
      "Status",
      "Nama Item",
      "Catatan",
      "Jumlah",
      "Harga",
      "Subtotal Item",
      "Subtotal Transaksi",
      "Diskon",
      "Ongkir",
      "Total Transaksi",
    ].join(PEMISAH),
  ];

  for (const s of struk) {
    /* Struk tanpa baris item tetap harus muncul di file. Kalau dilewati,
       omset yang tercatat di headernya hilang begitu saja tanpa jejak. */
    const lines = s.lines?.length ? s.lines : [null];
    for (const l of lines) {
      rows.push(
        [
          s.receiptNo,
          s.completedAt,
          s.customer,
          s.address ?? "",
          s.payment,
          s.status,
          l ? namaItem(l) : "",
          l?.note ?? "",
          l?.qty ?? "",
          l?.price ?? "",
          l ? l.price * l.qty : "",
          subtotalStruk(s),
          s.diskon ?? 0,
          s.ongkir ?? 0,
          s.total,
        ]
          .map(selCsv)
          .join(PEMISAH),
      );
    }
  }

  return rows.join("\n");
}

/** Nama file: `laporan-penjualan-2026-09-30.csv`. Rentang satu hari dipakai
    apa adanya; rentang panjang dipendekkan jadi dari-sampai. */
export function namaFileCsv(label: string, dariIso: string, sampaiIso: string): string {
  const bersih = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `laporan-penjualan-${bersih || `${dariIso}-sd-${sampaiIso}`}.csv`;
}

/** Unduh file CSV ke disk kasir.

    BOM (\ufeff) wajib: tanpa itu Excel membaca file UTF-8 sebagai ANSI,
    dan "Soto Madura" jadi "Soto Madura" dengan huruf berantakan.
    Revoke-nya ditunda satu tick — di Safari, URL yang langsung dicabut
    setelah .click() membuat download gagal diam-diam. */
export function unduhCsvPenjualan(namaFile: string, isi: string): void {
  const blob = new Blob(["﻿", isi], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = namaFile;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type HasilExport = { ok: true; namaFile: string; baris: number } | { ok: false; pesan: string };

/** Satu pintu untuk tombol Export CSV.

    Tanpa data, hasil `{ ok: false }` dan TIDAK ada file yang diunduh.
    Tombolnya sendiri juga dinonaktifkan di halaman, tapi Export CSV juga
    dipanggil dari jalan lain nanti, dan "tidak ada data" harus jadi
    kalimat yang jelas, bukan file kosong yang nanti dibuka Excel. */
export function exportPenjualanCsv({ struk, labelRentang }: OpsiExportCsv, dariIso: string, sampaiIso: string): HasilExport {
  const hidup = struk.filter((s) => s.status !== "terhapus");
  if (hidup.length === 0) {
    return { ok: false, pesan: "Belum ada transaksi di rentang ini." };
  }
  const namaFile = namaFileCsv(labelRentang, dariIso, sampaiIso);
  unduhCsvPenjualan(namaFile, teksCsvPenjualan(hidup));
  const baris = hidup.reduce((a, s) => a + Math.max(1, s.lines?.length ?? 0), 0);
  return { ok: true, namaFile, baris };
}