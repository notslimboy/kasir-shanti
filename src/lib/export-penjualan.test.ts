import { describe, expect, it } from "vitest";

import { namaFileCsv, selCsv, teksCsvPenjualan } from "./export-penjualan";
import type { Sale } from "./sale";

/* Tiga hal yang bisa bikin CSV-nya salah diam-diam: pemisah kolom yang
   salah (semua angka jadi satu kolom di Excel), sel yang tidak diapit
   kutip (nama item containing koma menggeser kolom), dan struk tanpa
   baris item yang hilang dari file. */

const struk = (over: Partial<Sale> = {}): Sale => ({
  id: 1,
  receiptNo: "048",
  customer: "Sari",
  completedOn: "2026-09-30",
  completedIso: "2026-09-30T06:05:00Z",
  completedAt: "30 Sep 2026 13.05",
  total: 52500,
  payment: "Tunai",
  itemCount: 2,
  status: "lunas",
  lines: [
    { name: "Nasi Goreng", variant: "", qty: 2, price: 20000 },
    { name: "Es Teh", variant: "Gulaaren", qty: 1, price: 5000 },
  ],
  ...over,
});

describe("selCsv", () => {
  it("tidak mengapit sel biasa", () => {
    expect(selCsv("Sari")).toBe("Sari");
    expect(selCsv(12)).toBe("12");
    expect(selCsv(undefined)).toBe("");
  });

  it("mengapit sel yang punya pemisah atau kutip, kutip jadi dua", () => {
    /* Koma TIDAP perlu kutip: pemisah file ini titik koma, jadi "Budi,
       7/17" tetap satu sel dan tidak menggeser kolom. */
    expect(selCsv("Budi, 7/17")).toBe("Budi, 7/17");
    expect(selCsv("a;b")).toBe('"a;b"');
    expect(selCsv('Sari "S"')).toBe('"Sari ""S"""');
    expect(selCsv("dua\nbaris")).toBe('"dua\nbaris"');
  });
});

describe("teksCsvPenjualan", () => {
  it("satu baris per item, pemisah titik koma", () => {
    const baris = teksCsvPenjualan([struk()]).split("\n");
    expect(baris).toHaveLength(3); // header + 2 item
    expect(baris[0].startsWith("Nomor Struk;Tanggal;Customer")).toBe(true);
    expect(baris[1]).toContain("048");
    expect(baris[1]).toContain("Nasi Goreng");
  });

  it("varian ikut ditulis di nama item", () => {
    expect(teksCsvPenjualan([struk()])).toContain("Es Teh (Gulaaren)");
  });

  it("kolom angka mentah, bukan format rupiah", () => {
    const kolom = teksCsvPenjualan([struk()]).split("\n")[1].split(";");
    expect(kolom[8]).toBe("2"); // jumlah
    expect(kolom[9]).toBe("20000"); // harga
    expect(kolom[14]).toBe("52500"); // total transaksi
  });

  it("struk tanpa baris item tetap muncul", () => {
    const teks = teksCsvPenjualan([struk({ lines: [] })]);
    expect(teks.split("\n")).toHaveLength(2);
    expect(teks).toContain("52500");
  });

  it("diskon dan ongkir jadi kolom sendiri, tidak menggagalkan total", () => {
    const teks = teksCsvPenjualan([struk({ diskon: 5000, ongkir: 10000 })]);
    const kolom = teks.split("\n")[1].split(";");
    expect(kolom[12]).toBe("5000");
    expect(kolom[13]).toBe("10000");
  });
});

describe("namaFileCsv", () => {
  it("label rentang jadi slug", () => {
    expect(namaFileCsv("Hari ini, 30 September 2026", "2026-09-30", "2026-09-30")).toBe(
      "laporan-penjualan-hari-ini-30-september-2026.csv",
    );
  });

  it("label kosong jatuh ke rentang ISO, tetap punya nama file", () => {
    expect(namaFileCsv("", "2026-09-24", "2026-09-30")).toBe(
      "laporan-penjualan-2026-09-24-sd-2026-09-30.csv",
    );
  });
});