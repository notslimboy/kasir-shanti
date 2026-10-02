import { describe, expect, it } from "vitest";

import {
  buildKitchenOrderTicket,
  formatQtyDapur,
  labelRentangKot,
  namaItemKot,
  type KotLine,
} from "./kot";

/* KOT adalah rekap per nama menu untuk satu rentang tanggal — bukan daftar
   struk. Kalau logika ini berubah, dapur akan menerima 30 baris "Nasi Goreng
   2x" alih-alih satu baris "Nasi Goreng 40x". */

const HARI = new Date(2026, 8, 30);

describe("namaItemKot", () => {
  const l = (variant: string): KotLine => ({
    name: "Nasi Goreng", variant, qty: 1, price: 20_000,
  });

  it("varian Normal tidak disebut — itu bawaan", () => {
    expect(namaItemKot(l("Normal"))).toBe("Nasi Goreng");
    expect(namaItemKot(l("normal"))).toBe("Nasi Goreng");
    expect(namaItemKot(l(" NORMAL "))).toBe("Nasi Goreng");
    expect(namaItemKot(l(""))).toBe("Nasi Goreng");
  });

  it("varian lain ikut disebut, dapur harus tahu", () => {
    expect(namaItemKot(l("Separuh"))).toBe("Nasi Goreng (Separuh)");
    expect(namaItemKot(l("Paket 5"))).toBe("Nasi Goreng (Paket 5)");
  });
});

describe("formatQtyDapur", () => {
  it("bulat ditulis polos, pecahan pakai format Indonesia", () => {
    expect(formatQtyDapur(40)).toBe("40");
    expect(formatQtyDapur(1.5)).toBe("1,5");
    expect(formatQtyDapur(0)).toBe("0");
    expect(formatQtyDapur(Number.NaN)).toBe("0");
  });
});

describe("labelRentangKot", () => {
  it("satu hari ditulis tanggal penuh", () => {
    expect(labelRentangKot(HARI, HARI)).toBe("30 September 2026");
  });

  it("rentang ditulis singkat, sama seperti app lama", () => {
    const dari = new Date(2026, 8, 1);
    const sampai = new Date(2026, 8, 30);
    expect(labelRentangKot(dari, sampai)).toBe("1 Sep - 30 Sep");
  });
});

describe("buildKitchenOrderTicket: agregasi", () => {
  const struk = [
    { lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 2, price: 20_000 }] },
    { lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 3, price: 20_000 }] },
    { lines: [{ name: "Ayam Goreng BaPut", variant: "Normal", qty: 5, price: 30_000 }] },
  ];

  it("item sama dari struk berbeda digabung jadi satu baris", () => {
    const k = buildKitchenOrderTicket(struk, HARI, HARI);
    const nasi = k.itemTotals.find((i) => i.name === "Nasi Goreng");
    expect(nasi?.quantity).toBe(5);
    expect(nasi?.total).toBe(100_000);
    expect(k.itemTotals).toHaveLength(2);
  });

  it("varian berbeda TIDAK digabung", () => {
    const k = buildKitchenOrderTicket(
      [
        { lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 2, price: 20_000 }] },
        { lines: [{ name: "Nasi Goreng", variant: "Separuh", qty: 7, price: 10_000 }] },
      ],
      HARI, HARI,
    );
    expect(k.itemTotals.map((i) => i.name).sort()).toEqual([
      "Nasi Goreng",
      "Nasi Goreng (Separuh)",
    ]);
    expect(k.itemCount).toBe(9);
  });

  it("diurutkan qty terbesar lebih dulu", () => {
    const k = buildKitchenOrderTicket(struk, HARI, HARI);
    expect(k.itemTotals[0].name).toBe("Ayam Goreng BaPut");
    expect(k.itemTotals[0].quantity).toBe(5);
    expect(k.itemTotals[1].quantity).toBe(5); // seri dipecah total
  });

  it("TOTAL ITEM = jumlah seluruh qty", () => {
    const k = buildKitchenOrderTicket(struk, HARI, HARI);
    expect(k.itemCount).toBe(10);
    expect(k.itemCount).toBe(k.itemTotals.reduce((a, i) => a + i.quantity, 0));
  });

  it("qty 0 dan negatif tidak ikut dihitung", () => {
    const k = buildKitchenOrderTicket(
      [{
        lines: [
          { name: "Kentang Goreng", variant: "Normal", qty: 0, price: 15_000 },
          { name: "Kentang Goreng", variant: "Normal", qty: -3, price: 15_000 },
          { name: "Kentang Goreng", variant: "Normal", qty: 4, price: 15_000 },
        ],
      }],
      HARI, HARI,
    );
    expect(k.itemTotals).toHaveLength(1);
    expect(k.itemCount).toBe(4);
  });
});

describe("buildKitchenOrderTicket: struk yang dihapus", () => {
  /* KOT adalah tiket masak. Kalau struk dibatalkan tapi barangnya masih
     nangkring di KOT, dapur tetap memasak bahan yang tidak ada
     pelanggannya. Itu bahan terbuang, jadi filter ini bukan tampilan —
     ini keselamatan dapur. */
  const dari = (status?: string, qty = 3) => ({
    status,
    lines: [{ name: "Nasi Goreng", variant: "Normal", qty, price: 20_000 }],
  });

  it("struk terhapus tidak masuk KOT sama sekali", () => {
    const k = buildKitchenOrderTicket([dari("terhapus", 3)], HARI, HARI);
    expect(k.itemTotals).toHaveLength(0);
    expect(k.itemCount).toBe(0);
  });

  it("catatan item dari struk terhapus juga hilang", () => {
    const k = buildKitchenOrderTicket(
      [
        {
          status: "terhapus",
          lines: [{ name: "Gulai", variant: "Normal", qty: 2, price: 25_000, note: "level 1" }],
        },
      ],
      HARI, HARI,
    );
    expect(k.notedItems).toHaveLength(0);
  });

  it("struk belum lunas TETAP dimasak", () => {
    // "belum" artinya pelanggan belum bayar, bukan bahwa pesanan dibatalkan.
    // Kalau ikut difilter, dapur berhenti memasak order yang sah.
    const k = buildKitchenOrderTicket([dari("belum", 4)], HARI, HARI);
    expect(k.itemTotals).toHaveLength(1);
    expect(k.itemCount).toBe(4);
  });

  it("struk lunas tetap dimasak", () => {
    const k = buildKitchenOrderTicket([dari("lunas", 2)], HARI, HARI);
    expect(k.itemCount).toBe(2);
  });

  it("struk tanpa status ikut dimasak", () => {
    // Pemanggil yang memang tidak punya kolom status (mis. rekap dari
    // sumber lain) tidak boleh ikut kehilangan pesanannya.
    const k = buildKitchenOrderTicket([dari(undefined, 5)], HARI, HARI);
    expect(k.itemCount).toBe(5);
  });

  it("hanya struk terhapus yang dilewati, sisanya tetap dihitung", () => {
    const k = buildKitchenOrderTicket(
      [dari("lunas", 2), dari("terhapus", 9), dari("belum", 3)],
      HARI, HARI,
    );
    expect(k.itemCount).toBe(5);
  });
});

describe("buildKitchenOrderTicket: catatan item", () => {
  it("catatan digabung per nama + catatan", () => {
    const k = buildKitchenOrderTicket(
      [
        { lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 2, price: 20_000, note: "Sambal pisah" }] },
        { lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 3, price: 20_000, note: "Sambal pisah" }] },
      ],
      HARI, HARI,
    );
    expect(k.notedItems).toHaveLength(1);
    expect(k.notedItems[0]).toEqual({ name: "Nasi Goreng", note: "Sambal pisah", quantity: 5 });
  });

  it("catatan berbeda tetap terpisah", () => {
    const k = buildKitchenOrderTicket(
      [{
        lines: [
          { name: "Nasi Goreng", variant: "Normal", qty: 2, price: 20_000, note: "Sambal pisah" },
          { name: "Nasi Goreng", variant: "Normal", qty: 1, price: 20_000, note: "Tanpa sambal" },
        ],
      }],
      HARI, HARI,
    );
    expect(k.notedItems).toHaveLength(2);
  });

  it("item tanpa catatan tidak masuk bagian catatan", () => {
    const k = buildKitchenOrderTicket(
      [{ lines: [{ name: "Kentang Goreng", variant: "Normal", qty: 4, price: 15_000 }] }],
      HARI, HARI,
    );
    expect(k.notedItems).toEqual([]);
    expect(k.itemTotals).toHaveLength(1);
  });

  it("catatan kosong dan spasi diabaikan", () => {
    const k = buildKitchenOrderTicket(
      [{
        lines: [
          { name: "A", variant: "Normal", qty: 1, price: 1_000, note: "" },
          { name: "B", variant: "Normal", qty: 1, price: 1_000, note: "   " },
        ],
      }],
      HARI, HARI,
    );
    expect(k.notedItems).toEqual([]);
  });
});

describe("buildKitchenOrderTicket: rentang kosong", () => {
  it("tidak ada struk = KOT kosong, bukan error", () => {
    const k = buildKitchenOrderTicket([], HARI, HARI);
    expect(k.itemTotals).toEqual([]);
    expect(k.notedItems).toEqual([]);
    expect(k.itemCount).toBe(0);
    expect(k.dateLabel).toBe("30 September 2026");
  });

  it("struk tanpa baris item diabaikan", () => {
    const k = buildKitchenOrderTicket([{}, { lines: [] }], HARI, HARI);
    expect(k.itemCount).toBe(0);
  });

  it("harga tidak pernah ikut ke KOT", () => {
    // Dapur tidak butuh nominal. Kalau ada field total yang bocor ke KOT,
    // test ini yang akan menangkap.
    const k = buildKitchenOrderTicket(
      [{ lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 2, price: 20_000 }] }],
      HARI, HARI,
    );
    const kunci = Object.keys(k);
    expect(kunci.sort()).toEqual(["dateLabel", "itemCount", "itemTotals", "notedItems"]);
  });
});
