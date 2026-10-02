import { describe, expect, it } from "vitest";

import { kandidatJelas, kemiripanBigram, namaPokok, rankedKandidat, skorKandidat, varianDariNama, type KandidatProduk } from "./cocok-produk";
import { blockingDraft, cocokkanDraft, rekapDraft, siapDraft, statusDraft } from "./status-draft";
import type { ItemImpor, PesananImpor } from "./impor-pesanan";

/* Dua aturan yang bikin fitur lama cepat dipakai:
   1. Nama dari chat WA hampir tidak pernah sama persis dengan nama menu,
      jadi harus ada fuzzy match ("nasi goreng rumahan" → "Nasi Goreng Rumah").
   2. Kalau dua kandidat berdekatan, barang TIDAK dipilih diam-diam — kasir
      yang memilih lewat "Pilih Barang". Salah pilih lebih mahal daripada
      memilih satu klik lagi. */

const produk = (client_id: string, name: string, harga: number, akronim = ""): KandidatProduk => ({
  client_id,
  name,
  sku: "",
  aliases: akronim ? [akronim] : [],
  stok: null,
  variants: [
    { name: "Normal", price: harga, pricing_type: "fixed" },
    { name: "Separuh", price: Math.round(harga / 2), pricing_type: "fixed" },
    { name: "Custom input", price: 0, pricing_type: "custom" },
  ],
});

const KATALOG = [
  produk("p1", "Nasi Goreng Rumahan", 25_000),
  produk("p2", "Nasi Goreng Seafood", 28_000),
  produk("p3", "Es Teh", 5_000),
  produk("p4", "Kwetiau", 20_000, "kwetiauOri"),
];

describe("namaPokok & varianDariNama", () => {
  it("memisahkan keterangan porsi dari nama", () => {
    expect(namaPokok("Nasi Goreng 1/2")).toBe("nasi goreng");
    expect(namaPokok("Es Teh Separuh")).toBe("es teh");
    expect(namaPokok("Nasi Goreng")).toBe("nasi goreng");
  });

  it("membaca varian yang disebut di dalam nama", () => {
    expect(varianDariNama("Nasi Goreng 1/2")).toBe("Separuh");
    expect(varianDariNama("Es Teh setengah")).toBe("Separuh");
    expect(varianDariNama("Nasi Goreng")).toBe("");
  });
});

describe("kemiripanBigram", () => {
  it("identik = 1", () => {
    expect(kemiripanBigram("kwetiau", "kwetiau")).toBe(1);
  });

  it("salah ketik satu huruf tetap dekat", () => {
    expect(kemiripanBigram("kwetiau", "kwetiaw")).toBeGreaterThan(0.6);
  });

  it("kata beda total = rendah", () => {
    // Batasnya 11/30 ≈ 0,37: di bawah itu kandidat tidak pernah lolos ke
    // daftar saran, walau masih ada satu kata yang sama.
    expect(kemiripanBigram("nasi goreng seafood", "nasi putih")).toBeLessThan(11 / 30);
  });
});

describe("skorKandidat", () => {
  it("nama persis = skor tertinggi", () => {
    expect(skorKandidat(KATALOG[0], "Nasi Goreng Rumahan")).toBe(100);
  });

  it("nama dengan keterangan porsi tetap cocok", () => {
    expect(skorKandidat(KATALOG[0], "Nasi Goreng Rumahan 1/2")).toBe(100);
  });

  it("huruf besar, spasi, dan tanda baca diabaikan", () => {
    expect(skorKandidat(KATALOG[2], "  es   teh ")).toBe(100);
  });

  it("alias ikut dicocokkan", () => {
    expect(skorKandidat(KATALOG[3], "kwetiau ori")).toBeGreaterThan(60);
  });

  it("satu kata yang sama saja TIDAK dianggap cocok", () => {
    // "Nasi Putih" dan "nasi goreng seafood" sama-sama punya kata "nasi".
    // Kalau ini lolos, kasir diam-diam dapat menu yang salah.
    expect(skorKandidat(KATALOG[2], "nasi goreng seafood")).toBeLessThan(11);
    expect(skorKandidat(produk("x", "Nasi Putih", 5_000), "nasi goreng seafood")).toBeLessThan(11);
  });

  it("dua kata yang sama tetap dianggap cocok", () => {
    expect(skorKandidat(produk("x", "Nasi Goreng Ayam", 20_000), "nasi goreng")).toBeGreaterThan(50);
  });

  it("salah ketik ringan masih kena lewat bigram", () => {
    // "kwetiaw" vs "kwetiau": beda satu huruf, tidak ada kata yang cocok persis.
    expect(skorKandidat(KATALOG[3], "kwetiaw")).toBeGreaterThan(11);
  });

  it("nama kosong = 0", () => {
    expect(skorKandidat(KATALOG[0], "")).toBe(0);
  });
});

describe("rankedKandidat & kandidatJelas", () => {
  it("menempatkan yang paling cocok di depan", () => {
    const r = rankedKandidat(KATALOG, "nasi goreng seafood");
    expect(r[0].produk.client_id).toBe("p2");
  });

  it("satu-satunya kandidat dianggap jelas", () => {
    expect(kandidatJelas(rankedKandidat(KATALOG, "es teh"))).toBe(true);
  });

  it("nama persis tetap menang meski ada yang mirip", () => {
    // "Nasi Goreng" persis (100) mengalahkan "Nasi Goreng Rumah" (90) —
    // selisih 6 poin sudah cukup, dan ini memang yang diinginkan.
    const dua = [produk("a", "Nasi Goreng", 20_000), produk("b", "Nasi Goreng Rumah", 22_000)];
    expect(kandidatJelas(rankedKandidat(dua, "nasi goreng"))).toBe(true);
  });

  it("dua kandidat benar-benar berdekatan TIDAK dipilih diam-diam", () => {
    // Tidak ada yang cocok persis; dua menu berbagi kata dan skornya dekat.
    const dua = [produk("a", "Ayam Goreng Bakar", 20_000), produk("b", "Ayam Goreng Kukus", 22_000)];
    expect(kandidatJelas(rankedKandidat(dua, "ayam goreng"))).toBe(false);
  });

  it("tidak ada kandidat = tidak jelas", () => {
    expect(kandidatJelas([])).toBe(false);
  });
});

const item = (p: Partial<ItemImpor> = {}): ItemImpor => ({
  nama: "Nasi Goreng Rumahan",
  qty: 2,
  harga: 0,
  hargaKosong: true,
  productClientId: "",
  productName: "",
  perluCekHarga: false,
  stok: null,
  catatan: "",
  varian: "",
  sku: "",
  baris: 2,
  ...p,
});

const draft = (items: ItemImpor[], p: Partial<PesananImpor> = {}): PesananImpor => ({
  customer: "Bu Ani",
  tanggal: "2026-05-28",
  jam: "10:15",
  completedAt: "2026-05-28T03:15:00.000Z",
  payment: "Tunai",
  ongkir: 10_000,
  sendNote: "",
  items,
  subtotal: items.reduce((a, i) => a + i.qty * i.harga, 0),
  total: items.reduce((a, i) => a + i.qty * i.harga, 0) + 10_000,
  baris: 2,
  ...p,
});

describe("cocokkanDraft", () => {
  it("barang dicocokkan otomatis kalau kandidat tunggal", () => {
    const d = cocokkanDraft(draft([item({ nama: "Es Teh" })]), KATALOG);
    expect(d.items[0].productClientId).toBe("p3");
    expect(d.items[0].harga).toBe(5_000);
    expect(d.items[0].hargaKosong).toBe(false);
    expect(siapDraft(d)).toBe(true);
  });

  it("varian dari nama dipakai, bukan varian pertama", () => {
    const d = cocokkanDraft(draft([item({ nama: "Nasi Goreng Rumahan 1/2" })]), KATALOG);
    expect(d.items[0].varian).toBe("Separuh");
    expect(d.items[0].harga).toBe(12_500);
  });

  it("dua kandidat berdekatan dibiarkan belum cocok", () => {
    const dua = [produk("a", "Ayam Goreng Bakar", 20_000), produk("b", "Ayam Goreng Kukus", 22_000)];
    const d = cocokkanDraft(draft([item({ nama: "Ayam Goreng" })]), dua);
    expect(d.items[0].productClientId).toBe("");
    expect(statusDraft(d)).toBe("Perlu review");
  });

  it("harga custom tidak ditebak — ditandai perlu dicek", () => {
    const katalogTanpaCustom = KATALOG.map((p) => ({
      ...p,
      variants: [{ name: "Custom input", price: 0, pricing_type: "custom" }],
    }));
    const d = cocokkanDraft(draft([item({ nama: "Kwetiau" })]), katalogTanpaCustom);
    expect(d.items[0].productClientId).toBe("p4");
    expect(d.items[0].harga).toBe(0);
    expect(d.items[0].perluCekHarga).toBe(true);
    // Perlu dicek bukan blocking, tapi harga kosong tetap menahan simpan.
    expect(blockingDraft(d)).toEqual([]);
    expect(siapDraft(d)).toBe(true);
  });

  it("harga dari CSV tidak ditimpa katalog", () => {
    const d = cocokkanDraft(draft([item({ nama: "Es Teh", harga: 7_000, hargaKosong: false })]), KATALOG);
    expect(d.items[0].harga).toBe(7_000);
  });
});

describe("status draft", () => {
  it("belum cocok barang = blocking", () => {
    const d = draft([item()]);
    expect(blockingDraft(d)[0].pesan).toContain("belum cocok barang");
    expect(statusDraft(d)).toBe("Perlu review");
  });

  it("stok kurang = blocking, dengan sisa stok disebut", () => {
    const d = draft([item({ productClientId: "p1", productName: "Nasi Goreng", harga: 25_000, hargaKosong: false, qty: 5, stok: 3 })]);
    expect(blockingDraft(d)[0].pesan).toContain("stok kurang (sisa 3)");
  });

  it("jumlah kosong = blocking", () => {
    const d = draft([item({ productClientId: "p1", productName: "Nasi Goreng", harga: 25_000, hargaKosong: false, qty: 0 })]);
    expect(blockingDraft(d)[0].pesan).toContain("jumlah kosong");
  });

  it("customer kosong hanya info, tidak memblokir", () => {
    const d = draft([item({ productClientId: "p3", productName: "Es Teh", harga: 5_000, hargaKosong: false })], { customer: "" });
    expect(blockingDraft(d)).toEqual([]);
    expect(statusDraft(d)).toBe("Siap");
  });

  it("rekap menghitung semua / perlu review / siap", () => {
    const siap = draft([item({ productClientId: "p3", productName: "Es Teh", harga: 5_000, hargaKosong: false })]);
    const review = draft([item()], { baris: 9 });
    const r = rekapDraft([siap, review]);
    expect(r).toEqual({ semua: 2, perluReview: 1, siap: 1, itemSiap: 1 });
  });
});