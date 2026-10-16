import { afterEach, describe, expect, it, vi } from "vitest";

import { simpanPenjualan, subtotalDari, type BarisJual } from "./simpan-penjualan";

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

/* -------------------------------------------------------------------------
   Status awal struk baru

   Struk yang lahir sudah "Lunas" membuat piutang hilang tanpa jejak: tidak
   ada lagi yang tahu mana yang benar-benar sudah dibayar, dan halaman Piutang
   kosong padahal uangnya belum masuk. Karena itu yang diperiksa di sini
   adalah BODY permintaan ke server — satu-satunya tempat angka itu ditentukan.
   -------------------------------------------------------------------------- */

const panggil: { url: string; method: string; body: Record<string, unknown> }[] = [];

function tiruServer() {
  panggil.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      panggil.push({
        url: String(url),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      const json = (d: unknown) =>
        new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
      if (method === "GET") return json([]);
      if (String(url).includes("/sales?") || String(url).endsWith("/sales")) {
        return json([{ id: 99 }]);
      }
      return json([{ id: 1 }]);
    }),
  );
}

const PENJUALAN = {
  customer: "Memet 22",
  payment: "Tunai",
  items: [baris({ price: 25_000, qty: 2, tanpaBatas: true })],
  ongkir: 0,
  diskon: 0,
  note: "",
  sendNote: "",
};

describe("simpanPenjualan — status awal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("menulis paid_amount 0, bukan total", async () => {
    tiruServer();
    await simpanPenjualan({
      ...PENJUALAN,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    const post = panggil.find((p) => p.method === "POST" && p.url.endsWith("/sales"));
    expect(post).toBeDefined();
    expect(post!.body.paid_amount).toBe(0);
    /* Totalnya sendiri tetap benar — yang berubah hanya status awalnya. */
    expect(post!.body.total).toBe(50_000);
  });
});