import { describe, expect, it } from "vitest";

import { cariOpsiItem, opsiItemStruk } from "./pilih-item-struk";
import type { Product } from "./menu-seed";

/* Daftar pilihan untuk "Tambah item" di form Ubah Data struk. */

function varian(name: string, price: number, extra: Partial<Product["variants"][number]> = {}) {
  return {
    client_id: `v-${name}`,
    name,
    pricing_type: "fixed",
    price,
    unit_name: "",
    package_quantity: 1,
    receipt_label: "",
    is_default: name === "Normal",
    allow_quantity_override: true,
    allow_price_override: false,
    active: true,
    ...extra,
  };
}

function produk(name: string, variants: Product["variants"], client = `p-${name}`): Product {
  return {
    client_id: client,
    name,
    sku: "",
    category: "Makanan",
    aliases: [],
    stock: 10,
    stock_unlimited: false,
    variants,
  };
}

describe("opsiItemStruk", () => {
  it("membuat satu opsi per varian aktif", () => {
    const opsi = opsiItemStruk([
      produk("Ayam Goreng Laos", [varian("Normal", 30_000), varian("Separuh", 15_000)]),
    ]);
    expect(opsi.map((o) => o.label)).toEqual(["Ayam Goreng Laos", "Ayam Goreng Laos · Separuh"]);
    expect(opsi.map((o) => o.price)).toEqual([30_000, 15_000]);
  });

  it("tidak menyebut varian Normal di label", () => {
    /* "Nasi Goreng · Normal" hanya menambah kata tanpa memberi tahu apa pun,
       dan struknya juga tidak mencetak varian Normal. */
    const opsi = opsiItemStruk([produk("Nasi Goreng", [varian("Normal", 20_000)])]);
    expect(opsi[0]!.label).toBe("Nasi Goreng");
    expect(opsi[0]!.variant).toBe("Normal");
  });

  it("varian nonaktif tidak bisa dipilih", () => {
    const opsi = opsiItemStruk([
      produk("Soto", [varian("Normal", 25_000), varian("Jumbo", 35_000, { active: false })]),
    ]);
    expect(opsi.map((o) => o.label)).toEqual(["Soto"]);
  });

  it("produk tanpa varian aktif tidak muncul sama sekali", () => {
    const opsi = opsiItemStruk([produk("Kosong", [varian("Normal", 10_000, { active: false })])]);
    expect(opsi).toEqual([]);
  });

  it("varian custom masuk sebagai harga 0, bukan harga tebakan", () => {
    /* Harga custom artinya kasir yang mengetik. Mengisinya dengan harga varian
       lain akan membuat baris terlihat sudah lengkap padahal angkanya karangan. */
    const opsi = opsiItemStruk([
      produk("Paket Tumpeng", [varian("Custom", 0, { pricing_type: "custom" })]),
    ]);
    expect(opsi[0]!.custom).toBe(true);
    expect(opsi[0]!.price).toBe(0);
  });

  it("membawa client_id produk dan varian untuk ditulis ke sale_items", () => {
    const opsi = opsiItemStruk([produk("Es Teh", [varian("Normal", 5_000, { client_id: "v-teh" })], "p-teh")]);
    expect(opsi[0]!.productClientId).toBe("p-teh");
    expect(opsi[0]!.variantClientId).toBe("v-teh");
  });
});

describe("cariOpsiItem", () => {
  const daftar = opsiItemStruk([
    produk("Ayam Goreng Laos", [varian("Normal", 30_000)]),
    produk("Asem Asem Daging", [varian("Normal", 25_000)]),
    produk("Pepes Bandeng", [varian("Normal", 25_000)]),
  ]);

  it("mengembalikan semua opsi kalau pencarian kosong", () => {
    expect(cariOpsiItem(daftar, "").total).toBe(3);
  });

  it("mencocokkan tanpa peduli huruf besar-kecil", () => {
    expect(cariOpsiItem(daftar, "asem").tampil.map((o) => o.name)).toEqual(["Asem Asem Daging"]);
  });

  it("membatasi jumlah baris yang digambar, tapi melaporkan totalnya", () => {
    /* Katalog berisi ratusan baris; menggambar semuanya memperlambat drawer
       tanpa menambah pilihan yang berguna. */
    const { tampil, total } = cariOpsiItem(daftar, "a", 2);
    expect(tampil).toHaveLength(2);
    expect(total).toBe(3);
  });
});
