import { describe, expect, it } from "vitest";

import {
  labelTanggalCsv,
  namaFileCsvItsfood,
  teksCsvItsfoodHarian,
} from "./itsfood-export";
import type { ItsfoodOrder, ItsfoodOrderDetail } from "./itsfood";

const order = (id: string, customer = "Lab. ITS", deliveryTime = "11:00:00"): ItsfoodOrder => ({
  id,
  customer,
  orderedDate: "2026-11-09",
  orderedTime: "09:00:00",
  deliveryDate: "2026-11-09",
  deliveryTime,
  purpose: "Pengantaran",
  address: "Kampus ITS",
  status: "Belum diproses",
  canAccept: true,
});

const detail = (
  id: string,
  items: { name: string; price: string; qty: string; subtotal: string }[],
  lebih: Partial<ItsfoodOrderDetail> = {},
): ItsfoodOrderDetail => ({
  id,
  pemesan: "Bu Sinta",
  unit: "Lab",
  telepon: "",
  email: "",
  alamat: "Jl. ITS 1",
  waktuPemesanan: "",
  waktuPengantaran: "",
  tujuan: "",
  orderCost: "",
  serviceCharge: "",
  catatan: "jangan pedas",
  items,
  ...lebih,
});

describe("label & nama file", () => {
  it("ISO jadi tanggal pendek Indonesia", () => {
    expect(labelTanggalCsv("2026-11-09")).toBe("9 Nov 2026");
  });

  it("nama file mengikuti konvensi Order-tanggal", () => {
    expect(namaFileCsvItsfood("2026-11-09")).toBe(
      "Order-tanggal ITS Food 9 Nov 2026.csv",
    );
  });
});

describe("teksCsvItsfoodHarian", () => {
  it("header + rinci item + total order + total hari", () => {
    const a = order("1");
    const teks = teksCsvItsfoodHarian(
      [a],
      {
        "1": detail("1", [
          { name: "Nasi Uduk - Shanti Catering", price: "Rp. 44,000", qty: "2", subtotal: "Rp. 88,000" },
          { name: "Es Degan", price: "Rp. 10,000", qty: "25", subtotal: "Rp. 250,000" },
        ]),
      },
    );
    const baris = teks.split("\n");
    expect(baris[0]).toBe("Pemesan;Alamat;Jam Antar;Catatan;Item;Qty;Harga;Subtotal");
    /* Identitas cuma di baris item pertama */
    expect(baris[1]).toBe("Bu Sinta;Jl. ITS 1;11:00;jangan pedas;Nasi Uduk;2;44.000;88.000");
    expect(baris[2]).toBe(";;;;Es Degan;25;10.000;250.000");
    expect(baris[3]).toBe(";;;;Total order;;;338.000");
    expect(baris[4]).toBe(";;;;TOTAL HARI;;;338.000");
  });

  it("dua order: identitas masing-masing di baris pertamanya, total hari menjumlahkan keduanya", () => {
    const teks = teksCsvItsfoodHarian(
      [order("1"), order("2", "Fisika", "13:30:00")],
      {
        "1": detail("1", [{ name: "A", price: "Rp. 10,000", qty: "1", subtotal: "Rp. 10,000" }]),
        "2": detail("2", [{ name: "B", price: "Rp. 5,000", qty: "2", subtotal: "Rp. 10,000" }], { pemesan: "Fisika" }),
      },
    );
    const baris = teks.split("\n");
    expect(baris[1]).toContain("Bu Sinta");
    expect(baris[3]).toContain("Fisika");
    expect(baris[3].split(";")[2]).toBe("13:30");
    /* 10.000 + 10.000 */
    expect(baris[5]).toBe(";;;;TOTAL HARI;;;20.000");
  });

  it("sel berisi ';' / koma diapit kutip, kutip digandakan", () => {
    const teks = teksCsvItsfoodHarian(
      [order("1")],
      { "1": detail("1", [{ name: 'Ayam; bakso "spesial"', price: "Rp. 1,000", qty: "1", subtotal: "Rp. 1,000" }]) },
    );
    expect(teks.split("\n")[1]).toContain('"Ayam; bakso ""spesial"""');
  });

  it("detail gagal dimuat → baris pengganti, total hari tetap dari order lain", () => {
    const teks = teksCsvItsfoodHarian(
      [order("1"), order("2")],
      {
        /* "1" sengaja tidak ada — gagal/masih dimuat */
        "2": detail("2", [{ name: "B", price: "Rp. 5,000", qty: "1", subtotal: "Rp. 5,000" }], { pemesan: "Pak Budi" }),
      },
    );
    const baris = teks.split("\n");
    expect(baris[1]).toContain("detail gagal dimuat");
    expect(baris[2]).toContain("Pak Budi");
    expect(baris[3]).toBe(";;;;Total order;;;5.000");
    expect(baris[4]).toBe(";;;;TOTAL HARI;;;5.000");
  });

  it("tanpa order → cuma header, tanpa TOTAL HARI", () => {
    expect(teksCsvItsfoodHarian([], {})).toBe(
      "Pemesan;Alamat;Jam Antar;Catatan;Item;Qty;Harga;Subtotal",
    );
  });
});
