import { describe, expect, it } from "vitest";

import {
  flag,
  kategoriProduk,
  labelTanggalPendek,
  labelWaktuRingkas,
  labelWaktuLokal,
  tanggalISODari,
  mapCustomer,
  mapStruk,
  namaItemDari,
  ongkirDari,
  rekapPerCustomer,
  statusDari,
  varianUntukProduk,
  varianDariAlias,
  varianNormal,
} from "./live-mappers";
import { VARIAN_BLOB_PREFIX, type CustomerRow, type ProductVariantRow, type SaleRow } from "@/supabase/types";

/* Aturan di sini menentukan angka yang tampil di layar kasir. Semuanya
   diuji terhadap bentuk data NYATA dari Supabase, bukan tebakan. */

const struk = (p: Partial<SaleRow> = {}): SaleRow => ({
  id: 1,
  receipt_no: "SH-20260929-0053",
  completed_at: "2026-09-29T07:01:34.552+00:00",
  store_name: "Shanti Catering",
  payment: "Tunai",
  subtotal: 190_500,
  discount: 5_000,
  tax: 0,
  total: 195_500,
  customer_name: "Puri Asri P3 No 32 Nenet",
  customer_address: "",
  order_note: "",
  due_text: "",
  chat_date: "29/09/2026 10.59",
  deleted_at: null,
  stock_restored_on_delete: 0,
  paid_amount: 0,
  created_at: "2026-09-29T07:01:34.775276+00:00",
  queue_no: 53,
  queue_date: "2026-09-29",
  send_note: "",
  ...p,
});

describe("ongkir: tidak ada kolomnya, harus dihitung", () => {
  it("ongkir = total − subtotal, kolom diskon tidak ikut ditambah", () => {
    /* Contoh nyata: subtotal 190.500, diskon 5.000, total 195.500, dan
       customers.default_shipping untuk pelanggan itu = 5.000. Jadi ongkirnya
       5.000 — kolom `discount` hanya salinannya (versi lama menulis
       `discount: totals.shipping`), bukan pembawa ongkir kedua. */
    expect(ongkirDari(struk())).toBe(5_000);
  });

  it("ongkir tidak pernah dua kali lebih besar dari selisihnya", () => {
    // Regresi: rumus lama total − subtotal + diskon memberi 10.000 untuk
    // struk yang ongkirnya 5.000, jadi total ongkir dashboard melonjak.
    const s = struk();
    expect(ongkirDari(s)).toBe(s.total - s.subtotal);
  });

  it("struk tanpa ongkir berarti 0", () => {
    expect(ongkirDari(struk({ subtotal: 195_500, discount: 0, total: 195_500 }))).toBe(0);
  });

  it("pajak ikut dijumlahkan ke sisa", () => {
    expect(ongkirDari(struk({ subtotal: 100_000, discount: 0, tax: 10_000, total: 120_000 }))).toBe(30_000);
  });

  it("sisa negatif dibikin 0, bukan_minus", () => {
    // Data yang salah atau struk tanpa ongkir tidak boleh menampilkan "-5.000".
    expect(ongkirDari(struk({ subtotal: 100_000, discount: 0, total: 90_000 }))).toBe(0);
  });

  it("nilai null diperlakukan sebagai 0", () => {
    expect(
      ongkirDari({
        total: null as unknown as number,
        subtotal: null as unknown as number,
        discount: null as unknown as number,
        tax: null as unknown as number,
      }),
    ).toBe(0);
  });
});

describe("status struk: tidak ada kolomnya, harus diturunkan", () => {
  it("dihapus menang atas apa pun", () => {
    expect(statusDari(struk({ deleted_at: "2026-09-30T10:00:00Z", paid_amount: 999_999 }))).toBe("terhapus");
  });

  it("lunas kalau sudah dibayar penuh", () => {
    expect(statusDari(struk({ paid_amount: 195_500 }))).toBe("lunas");
    expect(statusDari(struk({ paid_amount: 200_000 }))).toBe("lunas");
  });

  it("belum lunas kalau belum ada pembayaran", () => {
    expect(statusDari(struk({ paid_amount: 0 }))).toBe("belum");
  });

  it("total 0 tidak dianggap lunas walau paid_amount 0", () => {
    expect(statusDari(struk({ total: 0, paid_amount: 0 }))).toBe("belum");
  });
});

describe("nama item", () => {
  /* Jangan pakai nama `it` — itu bendingunan milik vitest. */
  const baris = (p: Partial<Parameters<typeof namaItemDari>[0]>) => ({
    menu_name: "Nasi Goreng", name: "Nasi Goreng", variant_name: "Normal", receipt_label: "", ...p,
  });

  it("varian Normal tidak disebut", () => {
    expect(namaItemDari(baris({}))).toBe("Nasi Goreng");
  });

  it("varian lain ikut disebut — dapur harus tahu", () => {
    expect(namaItemDari(baris({ variant_name: "Separuh" }))).toBe("Nasi Goreng (Separuh)");
  });

  it("receipt_label menang atas nama varian", () => {
    expect(namaItemDari(baris({ variant_name: "Separuh", receipt_label: "Separuh porsi" }))).toBe("Nasi Goreng (Separuh porsi)");
  });

  it("menu_name kosong jatuh ke name", () => {
    expect(namaItemDari({ menu_name: "", name: "Jus Alpukat", variant_name: "Normal", receipt_label: "" })).toBe("Jus Alpukat");
  });
});

describe("label waktu: HARUS zona waktu lokal", () => {
  /* completed_at disimpan UTC. 07:01 UTC = 14:01 WIB. Kalau string-nya
     dipakai apa adanya, layar kasir menampilkan jam yang salah 7 jam dan
     struk]["sehari" yang mengelompokannya jadi salah. */
  /* Date#getHours dan friends sudah mengembalikan waktu lokal, jadi
     ekspektasinya cukup dibaca dari objek Date-nya — tanpa aritmetika
     offset, yang justru rawan salah tandanya. */

  it("jam dikonversi dari UTC ke waktu lokal", () => {
    const d = new Date("2026-09-29T07:01:34.552Z");
    const diharapkan = `${d.getDate()} September 2026, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(labelWaktuLokal(d.toISOString())).toBe(diharapkan);
  });

  it("tidak lagi menampilkan jam UTC mentah", () => {
    // Nilai UTC-nya 07:01. Kalau formatter masih memakai string mentah,
    // test ini gagal — dan itulah yang dulu terjadi.
    const tampil = labelWaktuLokal("2026-09-29T07:01:34.552Z");
    expect(tampil).not.toContain("07:01");
  });

  it("tanggal pendek ikut waktu lokal", () => {
    // 2026-09-29T20:00Z sudah 30 September di WIB.
    const t = new Date("2026-09-29T20:00:00.000Z");
    expect(labelTanggalPendek(t.toISOString())).toBe(`${t.getDate()} September 2026`);
  });

  it("tanggalISODari juga waktu lokal", () => {
    const t = new Date("2026-09-29T20:00:00.000Z");
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    expect(tanggalISODari(struk({ completed_at: t.toISOString() }))).toBe(iso);
  });

  it("tanggal tidak valid tidak bikin halaman crash", () => {
    expect(() => labelWaktuLokal("")).not.toThrow();
    expect(() => tanggalISODari(struk({ completed_at: "" }))).not.toThrow();
  });

  it("label ringkas memangkas nama bulan dan membuang tahun", () => {
    /* Bentuknya harus muat di kartu struk 320px berdampingan dengan
       tombol Hapus. Label penuh "6 Oktober 2026, 09:49" melebihi
       lebar dan terpotong jadi "6 Okt..." — tanggal hilang justru di
       layar terkecil, tempat yang paling tidak punya ruang. */
    const d = new Date("2026-10-06T02:49:00.000Z");
    const jam = String(d.getHours()).padStart(2, "0");
    const menit = String(d.getMinutes()).padStart(2, "0");
    expect(labelWaktuRingkas(d.toISOString())).toBe(`${d.getDate()} Okt ${jam}:${menit}`);
  });

  it("label ringkas memangkas semua bulan, bukan hanya Oktober", () => {
    /* Satu bulan yang benar saja belum menutupi bulan yang salah: daftar
       12 bulan disalin manual, jadi satu salah ketik akan lolos. */
    const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2026, m, 15, 2, 5));
      const tampil = labelWaktuRingkas(d.toISOString());
      expect(tampil).toContain(bulan[m]);
      expect(tampil.split(" ")[1]).toBe(bulan[m]);
    }
  });

  it("tidak ada tahun di label ringkas", () => {
    /* Tahun tidak menambah informasi di layar yang sudah menampilkan satu
       rentang tanggal, dan memakan lebar yang dibutuhkan jam. */
    expect(labelWaktuRingkas(new Date("2026-10-06T02:49:00.000Z").toISOString())).not.toContain("2026");
  });

  it("label ringkas tidak crash pada timestamp rusak", () => {
    expect(() => labelWaktuRingkas("")).not.toThrow();
    expect(labelWaktuRingkas("")).toBe("");
  });
});

describe("mapStruk", () => {
  it("baris item dijumlahkan jadi itemCount", () => {
    const s = mapStruk(struk(), [
      { name: "Nasi Goreng", menu_name: "Nasi Goreng", variant_name: "Normal", quantity: 2, price: 20_000, note: "", sku: "", line_total: 40_000, id: 1, sale_id: 1, product_client_id: "", variant_client_id: "", unit_name: "", unit_quantity: null, pricing_type: "fixed", receipt_label: "" },
      { name: "Es Kopi", menu_name: "Es Kopi", variant_name: "Normal", quantity: 1, price: 18_000, note: "", sku: "", line_total: 18_000, id: 2, sale_id: 1, product_client_id: "", variant_client_id: "", unit_name: "", unit_quantity: null, pricing_type: "fixed", receipt_label: "" },
    ]);
    expect(s.itemCount).toBe(3);
    expect(s.lines).toHaveLength(2);
    // Ongkir 5.000 (total 195.500 − subtotal 190.500). Kolom discount 5.000
    // tetap ikut dibaca sebagai nilai diskon apa adanya.
    expect(s.ongkir).toBe(5_000);
    expect(s.diskon).toBe(5_000);
    expect(s.completedOn).toMatch(/^2026-09-\d\d$/);
  });

  it("struk tanpa item tidak error", () => {
    const s = mapStruk(struk(), []);
    expect(s.itemCount).toBe(0);
    expect(s.lines).toEqual([]);
  });
});

describe("rekapPerCustomer", () => {
  it("menghitung jumlah & omzet per nama, mengabaikan struk dihapus", () => {
    const m = rekapPerCustomer([
      struk({ id: 1, customer_name: "Budi", total: 100_000 }),
      struk({ id: 2, customer_name: "Budi", total: 50_000 }),
      struk({ id: 3, customer_name: "Siti", total: 70_000 }),
      struk({ id: 4, customer_name: "Budi", total: 999_000, deleted_at: "2026-09-30T00:00:00Z" }),
      struk({ id: 5, customer_name: "   ", total: 10_000 }),
    ]);
    expect(m.get("Budi")).toEqual({ orderCount: 2, total: 150_000, last: "2026-09-29T07:01:34.552+00:00" });
    expect(m.get("Siti")?.total).toBe(70_000);
  });
});

describe("mapCustomer", () => {
  const c = (p: Partial<CustomerRow> = {}): CustomerRow => ({
    id: 1902,
    name: "Anak 7/37",
    default_shipping: 0,
    last_order_at: "2026-09-22T03:20:03.451Z",
    created_at: "2026-06-04T05:09:38.652+00:00",
    updated_at: "2026-09-22T03:20:04.257+00:00",
    deposit_balance: 0,
    tag: "Sutorejo",
    ...p,
  });

  it("ongkir default diambil dari default_shipping", () => {
    expect(mapCustomer(c({ default_shipping: 15_000 })).ongkir).toBe(15_000);
  });

  it("tag kosong jadi null, bukan string kosong", () => {
    expect(mapCustomer(c({ tag: "" })).tag).toBeNull();
    expect(mapCustomer(c({ tag: null })).tag).toBeNull();
    expect(mapCustomer(c({ tag: "ITS" })).tag).toBe("ITS");
  });

  it("alamat dan catatan dikosongkan — tidak ada kolomnya", () => {
    const m = mapCustomer(c());
    expect(m.address).toBe("");
    expect(m.note).toBe("");
  });

  it("rekap menimpa last order", () => {
    const m = mapCustomer(c(), { orderCount: 4, total: 900_000, last: "2026-09-29T10:00:00Z" });
    expect(m.orderCount).toBe(4);
    expect(m.lastOrder).toBe("29 September 2026");
  });

  it("tanpa rekap, jatuh ke last_order_at dari customers", () => {
    expect(mapCustomer(c()).lastOrder).toBe("22 September 2026");
    expect(mapCustomer(c({ last_order_at: null })).lastOrder).toBe("—");
  });
});

describe("varian produk", () => {
  const pv = (p: Partial<ProductVariantRow> = {}): ProductVariantRow => ({
    id: 1,
    client_id: "abc::normal",
    product_client_id: "abc",
    name: "Normal",
    pricing_type: "fixed",
    price: 10_000,
    unit_name: "porsi",
    package_quantity: 1,
    package_unit: "porsi",
    receipt_label: "",
    is_default: 1,
    allow_quantity_override: 1,
    allow_price_override: 0,
    stock: 0,
    stock_unlimited: 1,
    aliases: "[]",
    sort_order: 0,
    active: 1,
    updated_at: "2026-07-09T03:46:58.405046+00:00",
    ...p,
  });

  it("flag 0/1 Postgres dibaca sebagai boolean", () => {
    expect(flag(1)).toBe(true);
    expect(flag(0)).toBe(false);
    expect(flag(true)).toBe(true);
    expect(flag(null)).toBe(false);
    expect(flag("1")).toBe(true);
  });

  it("tabel product_variants jadi sumber utama", () => {
    const v = varianUntukProduk(
      { client_id: "abc", price: 10_000, aliases: null },
      [pv(), pv({ client_id: "abc::half", name: "Separuh", price: 5_000, is_default: 0 })],
    );
    expect(v).toHaveLength(2);
    expect(v[0].is_default).toBe(true);
  });

  it("produk tanpa baris varian dapat varian Normal sintetis", () => {
    // 342 dari 1000 produk pertama tidak punya baris product_variants.
    // Tanpa varian sintetis, produk itu tidak punya harga default.
    const v = varianUntukProduk({ client_id: "xyz", price: 20_000, aliases: null }, []);
    expect(v).toEqual([varianNormal("xyz", 20_000)]);
    expect(v[0].price).toBe(20_000);
    expect(v[0].is_default).toBe(true);
  });

  it("blob varian di kolom aliases dipakai kalau tabel kosong", () => {
    const blob = VARIAN_BLOB_PREFIX + encodeURIComponent(
      JSON.stringify([
        { client_id: "old::normal", name: "Normal", pricing_type: "fixed", price: 10000, is_default: 1, active: 1 },
        { client_id: "old::half", name: "Separuh", pricing_type: "fixed", price: 10000, is_default: 0, active: 1 },
      ]),
    );
    const v = varianUntukProduk({ client_id: "old", price: 10_000, aliases: blob }, []);
    expect(v).toHaveLength(2);
    expect(v[0].is_default).toBe(true);
  });

  it("alias rusak tidak menjatuhkan halaman", () => {
    expect(varianDariAlias(VARIAN_BLOB_PREFIX + "bukan-json")).toEqual([]);
    expect(varianDariAlias("[]")).toEqual([]);
    expect(varianDariAlias(null)).toEqual([]);
  });

  it("varian default selalu yang pertama", () => {
    const v = varianUntukProduk({ client_id: "abc", price: 1, aliases: null }, [
      pv({ client_id: "abc::half", name: "Separuh", is_default: 0 }),
      pv({ client_id: "abc::normal", name: "Normal", is_default: 1 }),
    ]);
    expect(v[0].name).toBe("Normal");
  });
});

describe("kategori produk", () => {
  it("kosong jadi label, bukan string kosong", () => {
    expect(kategoriProduk("")).toBe("Tanpa Kategori");
    expect(kategoriProduk("  ")).toBe("Tanpa Kategori");
    expect(kategoriProduk(null)).toBe("Tanpa Kategori");
    expect(kategoriProduk("Sayur")).toBe("Sayur");
  });
});
