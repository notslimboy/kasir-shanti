import { describe, expect, it } from "vitest";

import { subtotalDari, type BarisJual } from "./simpan-penjualan";

const baris = (p: Partial<BarisJual> = {}): BarisJual => ({
  productClientId: "item-1",
  variantClientId: "",
  menuName: "Nasi Goreng",
  variantName: "Normal",
  name: "Nasi Goreng",
  price: 25_000,
  qty: 2,
  note: "",
  ...p,
});

describe("subtotalDari", () => {
  it("harga × jumlah dijumlahkan per baris", () => {
    expect(
      subtotalDari([
        baris({ price: 25_000, qty: 2 }),
        baris({ price: 12_500, qty: 3, menuName: "Kwetiau" }),
      ]),
    ).toBe(87_500);
  });

  it("harga varian dipakai, bukan harga menu penuh", () => {
    // Varian "Separuh" berharaga setengah — kalau harga menu yang dipakai,
    // setiap porsi separuh tercatat terlalu mahal dua kali lipat.
    expect(subtotalDari([baris({ price: 12_500, qty: 1 })])).toBe(12_500);
  });

  it("nilai bukan angka dianggap 0, bukan menjumlahkan NaN", () => {
    expect(
      subtotalDari([
        baris({ price: Number.NaN, qty: 2 }),
        baris({ price: 5_000, qty: Number.NaN }),
      ]),
    ).toBe(0);
  });

  it("keranjang kosong = 0", () => {
    expect(subtotalDari([])).toBe(0);
  });
});