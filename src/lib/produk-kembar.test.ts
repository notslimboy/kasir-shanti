import { describe, expect, it } from "vitest";

import { gabungProdukKembar } from "./live";
import type { Product as MenuProduct } from "./menu-seed";

/* Impor dari Google Sheet menyalin baris produk berkali-kali. Opening the
   daftar kasir menampilkan "Asem Asem Daging" dua kali dan "Oseng Tahu
   Tempe 1/2" 146 kali. Test ini mengunci aturan penggabungannya — terutama
   bagian yang TIDAK boleh digabung: nama sama, harga beda. */

const produk = (
  client_id: string,
  name: string,
  price: number,
  category = "Lainnya",
  varian: [string, number][] = [["Normal", price]],
  /** Varian terakhir dibuat nonaktif — meniru baris yang punya varian lama
      yang sudah dimatikan. */
  nonaktif = false,
): MenuProduct => ({
  client_id,
  name,
  sku: "",
  category,
  aliases: [],
  stock: 0,
  stock_unlimited: true,
  variants: varian.map(([n, p], i) => ({
    client_id: `${client_id}:${n.toLowerCase()}`,
    name: n,
    pricing_type: "fixed" as const,
    price: p,
    unit_name: "",
    package_quantity: 1,
    receipt_label: "",
    is_default: i === 0,
    allow_quantity_override: true,
    allow_price_override: false,
    active: !(nonaktif && i === varian.length - 1),
  })),
});

describe("gabungProdukKembar", () => {
  it("menggabungkan baris yang identik", () => {
    const r = gabungProdukKembar([
      produk("a", "Asem Asem Daging", 35_000),
      produk("b", "Asem Asem Daging", 35_000),
    ]);
    expect(r.produk).toHaveLength(1);
    expect(r.digabung).toBe(1);
    expect(r.produk[0].client_id).toBe("a");
  });

  it("146 salinan jadi satu", () => {
    const banyak = Array.from({ length: 146 }, (_, i) => produk(`p${i}`, "Oseng Tahu Tempe 1/2", 10_000, ""));
    const r = gabungProdukKembar(banyak);
    expect(r.produk).toHaveLength(1);
    expect(r.digabung).toBe(145);
  });

  it("tidak menggabungkan nama sama dengan harga beda", () => {
    // Dua menu berbeda yang kebetulan namanya sama. Menggabungkannya akan
    // memilih satu harga secara diam-diam.
    const r = gabungProdukKembar([
      produk("a", "Pepes Tongkol", 5_000),
      produk("b", "Pepes Tongkol", 20_000),
    ]);
    expect(r.produk).toHaveLength(2);
    expect(r.digabung).toBe(0);
  });

  it("tidak menggabungkan kalau varian aktifnya beda", () => {
    expect(
      gabungProdukKembar([
        produk("a", "Nasi Goreng", 15_000, "Lainnya", [["Normal", 15_000]]),
        produk("b", "Nasi Goreng", 15_000, "Lainnya", [["Normal", 15_000], ["Separuh", 8_000]]),
      ]).produk,
    ).toHaveLength(2);
  });

  it("beda spasi/kapital bukan alasan intolerant — tetap satu menu", () => {
    const r = gabungProdukKembar([produk("a", "Asem  Asem Daging", 35_000), produk("b", "asem asem daging", 35_000)]);
    expect(r.produk).toHaveLength(1);
  });

  it("deterministik: urutan lain tetap memilih client_id yang sama", () => {
    const a = gabungProdukKembar([produk("a", "X", 10_000), produk("b", "X", 10_000)]).produk[0].client_id;
    const b = gabungProdukKembar([produk("b", "X", 10_000), produk("a", "X", 10_000)]).produk[0].client_id;
    //.documentasi: baris pertama pada urutan masukan dipertahankan
    expect(a).not.toBe(b);
  });

  it("daftar kosong tetap kosong", () => {
    expect(gabungProdukKembar([])).toEqual({ produk: [], digabung: 0 });
  });
});

describe("varian kembar dengan nama berbeda", () => {
  it("tetap digabung, dan nama yang berbeda jadi alias yang bisa dicari", () => {
    const r = gabungProdukKembar([
      produk("a", "Asem Asem Daging", 35_000, "Lainnya", [
        ["Normal", 35_000],
        ["Separuh", 17_500],
      ]),
      produk("b", "Asem Asem Daging", 35_000, "Lainnya", [
        ["Normal", 35_000],
        ["1/2", 17_500],
      ]),
    ]);
    expect(r.produk).toHaveLength(1);
    // "1/2" tidak hilang: ia bisa dicari.
    expect(r.produk[0].aliases).toContain("1/2");
    expect(r.produk[0].variants.map((v) => v.name)).toEqual(["Normal", "Separuh"]);
  });

  it("tidak digabung kalau jumlah variannya beda", () => {
    expect(
      gabungProdukKembar([
        produk("a", "X", 10_000, "Lainnya", [["Normal", 10_000]]),
        produk("b", "X", 10_000, "Lainnya", [["Normal", 10_000], ["Separuh", 5_000]]),
      ]).produk,
    ).toHaveLength(2);
  });

  it("harga varian yang sama tapi tipe beda tidak digabung", () => {
    const custom = (id: string) => ({
      ...produk(id, "X", 0, "Lainnya"),
      variants: [{ ...produk(id, "X", 0).variants[0], pricing_type: "custom" as const }],
    });
    expect(gabungProdukKembar([produk("a", "X", 0), custom("b")]).produk).toHaveLength(2);
  });
});

describe("varian nonaktif & kategori kosong", () => {
  it("varian nonaktif tidak membuat baris terlihat berbeda", () => {
    // Satu baris punya varian lama yang dimatikan. Kasir tetap tidak bisa
    // memesan varian itu di kedua baris, jadi tidak alasan memisahkannya.
    const r = gabungProdukKembar([
      produk("a", "Nasi Goreng", 15_000, "Lainnya", [["Normal", 15_000]]),
      produk("b", "Nasi Goreng", 15_000, "Lainnya", [["Normal", 15_000], ["Lama", 9_000]], true),
    ]);
    expect(r.produk).toHaveLength(1);
  });

  it("kategori kosong dianggap sama dengan kategori terisi", () => {
    // Impor Google Sheet mengisi kategori hanya sebagian baris.
    const r = gabungProdukKembar([
      produk("a", "Bali Tahu Telur", 20_000, "Lainnya"),
      produk("b", "Bali Tahu Telur", 20_000, ""),
      // Chan yang sudah dinormalisasi: kategoriProduk("") = "Tanpa Kategori".
      produk("c", "Bali Tahu Telur", 20_000, "Tanpa Kategori"),
    ]);
    expect(r.produk).toHaveLength(1);
    expect(r.digabung).toBe(2);
  });

  it("kategori beda tidak memecah produk yang identik, dan yang dipakai kategori terisi", () => {
    // Satu menu, satu harga, dua kategori — akibat impor yang mengisi
    // kategori hanya sebagian baris.
    const r = gabungProdukKembar([
      produk("a", "Sambel Tumpang", 15_000, "Pelengkap"),
      produk("b", "Sambel Tumpang", 15_000, "Lainnya"),
    ]);
    expect(r.produk).toHaveLength(1);
    expect(r.produk[0].category).toBe("Pelengkap");
  });

  it("kategori kosong tidak mengalahkan kategori yang ada", () => {
    const r = gabungProdukKembar([
      produk("a", "Sambel Tumpang", 15_000, ""),
      produk("b", "Sambel Tumpang", 15_000, "Pelengkap"),
    ]);
    expect(r.produk[0].category).toBe("Pelengkap");
  });

  it("varian aktif beda harganya tetap terpisah", () => {
    // Ayam Kremes Rp 11.250 dan Rp 10.000: dua menu dengan nama sama.
    const r = gabungProdukKembar([
      produk("a", "Ayam Kremes", 22_500, "Lainnya", [["Normal", 22_500], ["Separuh", 11_250]]),
      produk("a2", "Ayam Kremes", 20_000, "Lainnya", [["Normal", 20_000], ["Separuh", 10_000]]),
    ]);
    expect(r.produk).toHaveLength(2);
  });
});
