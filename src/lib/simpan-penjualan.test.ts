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

/* -------------------------------------------------------------------------
   Deposit dipotong otomatis saat transaksi.

   `deposit_used` harus ikut di INSERT, `paid_amount` diisi sebesar deposit,
   dan saldo customer dikurangi.
   -------------------------------------------------------------------------- */

const depositPanggil: { url: string; method: string; body: Record<string, unknown> }[] = [];

function tiruServerDeposit() {
  depositPanggil.length = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      depositPanggil.push({ url: String(url), method, body });

      const u = String(url);
      const json = (d: unknown, status = 200) =>
        new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

      /* GET /sales — nomor struk */
      if (method === "GET" && u.includes("/sales?")) return json([]);
      /* GET /customers — deposit lookup + sentuhCustomer */
      if (method === "GET" && (u.includes("/rest/v1/customers") || u.includes("name=eq.")))
        return json([{ id: 164, name: "Memet 22", deposit_balance: 50_000, last_order_at: "", default_shipping: 0 }]);
      /* GET product_variants/products — untuk kurangiStok */
      if (method === "GET") return json([]);

      /* POST /sales — simpan struk */
      if ((method === "POST") && (u.endsWith("/sales") || u.includes("/sales?")))
        return json([{ id: 99 }]);
      /* POST /sale_items */
      if ((method === "POST") && u.includes("/sale_items"))
        return json([{ id: 1 }]);

      /* PATCH /customers — update deposit */
      if (method === "PATCH" && u.includes("/rest/v1/customers"))
        return json([{ id: 164 }]);
      /* PATCH /sales — sentuhCustomer update */
      if (method === "PATCH") return json([{ id: 99 }]);

      /* deposit_ledger POST */
      if (method === "POST" && u.includes("/rest/v1/deposit_ledger")) return json([{ id: 1 }]);
      if (method === "POST") return json([{ id: 1 }]);
      return json([]);
    }),
  );
}

describe("simpanPenjualan — deposit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deposit_used dan paid_amount terisi saat usedDeposit dikirim", async () => {
    tiruServerDeposit();
    const hasil = await simpanPenjualan({
      ...PENJUALAN,
      usedDeposit: 20_000,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    /* INSERT sales: deposit_used dan paid_amount = 20.000 */
    const post = depositPanggil.find((p) => p.method === "POST" && p.url.endsWith("/sales"));
    expect(post).toBeDefined();
    expect(post!.body.deposit_used).toBe(20_000);
    expect(post!.body.paid_amount).toBe(20_000);
    expect(post!.body.total).toBe(50_000);

    /* Hasil jual mencantumkan usedDeposit */
    expect(hasil.struk.usedDeposit).toBe(20_000);

    /* Customer deposit dikurangi (cek PATCH terakhir ke customers) */
    const patchCustomers = depositPanggil.filter(
      (p) => p.method === "PATCH" && p.url.includes("/rest/v1/customers"),
    );
    /* PATCH terakhir adalah pengurangan deposit (sentuhCustomer mungkin PATCH juga,
       tapi tidak mengirim deposit_balance) */
    const patchDeposit = patchCustomers.find((p) => p.body.deposit_balance !== undefined);
    expect(patchDeposit).toBeDefined();
    /* Saldo awal 50.000 - 20.000 = 30.000 */
    expect(patchDeposit!.body.deposit_balance).toBe(30_000);

    /* Tidak ada peringatan — semua lancar */
    expect(hasil.peringatanDeposit).toBeUndefined();

    /* deposit_ledger tercatat */
    const ledger = depositPanggil.filter(
      (p) => p.method === "POST" && p.url.includes("/rest/v1/deposit_ledger"),
    );
    expect(ledger).toHaveLength(1);
    const body = ledger[0].body;
    expect(body.customer_id).toBe(164);
    expect(body.amount).toBe(-20_000);
    expect(body.sale_id).toBe(99);
    expect(body.note).toContain("Dipakai di struk");
  });

  it("deposit > total dipotong jadi total", async () => {
    tiruServerDeposit();
    const hasil = await simpanPenjualan({
      ...PENJUALAN,
      usedDeposit: 100_000,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    const post = depositPanggil.find((p) => p.method === "POST" && p.url.endsWith("/sales"));
    expect(post).toBeDefined();
    /* total = 50.000 → deposit dibatasi jadi 50.000 */
    expect(post!.body.deposit_used).toBe(50_000);
    expect(post!.body.paid_amount).toBe(50_000);
    expect(hasil.struk.usedDeposit).toBe(50_000);
  });

  it("deposit 0 tidak memicu pengurangan saldo", async () => {
    tiruServerDeposit();
    await simpanPenjualan({
      ...PENJUALAN,
      usedDeposit: 0,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    /* Tidak ada PATCH ke customers untuk deposit — hanya sentuhCustomer */
    const patchCustomers = depositPanggil.filter(
      (p) => p.method === "PATCH" && p.url.includes("/rest/v1/customers") && p.body.deposit_balance !== undefined,
    );
    expect(patchCustomers).toHaveLength(0);
  });

  it("deposit tanpa default juga 0 — tidak crash", async () => {
    tiruServerDeposit();
    const hasil = await simpanPenjualan({
      ...PENJUALAN,
      usedDeposit: undefined,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    const post = depositPanggil.find((p) => p.method === "POST" && p.url.endsWith("/sales"));
    expect(post!.body.deposit_used).toBe(0);
    expect(post!.body.paid_amount).toBe(0);
    expect(hasil.struk.usedDeposit).toBe(0);
  });

  it("gagal kurangi deposit tidak menggagalkan transaksi", async () => {
    depositPanggil.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        depositPanggil.push({ url: String(url), method, body });
        const u = String(url);
        const json = (d: unknown, status = 200) =>
          new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

        if (method === "GET" && u.includes("/sales?")) return json([]);
        if (method === "GET" && (u.includes("/rest/v1/customers") || u.includes("name=eq.")))
          return json([{ id: 164, name: "Memet 22", deposit_balance: 50_000 }]);
        if (method === "GET") return json([]);
        if (method === "POST" && (u.endsWith("/sales") || u.includes("/sales?")))
          return json([{ id: 99 }]);
        if (method === "POST" && u.includes("/sale_items")) return json([{ id: 1 }]);
        /* PATCH customers GAGAL */
        if (method === "PATCH" && u.includes("/rest/v1/customers"))
          return json({ message: "denied" }, 403);
        if (method === "PATCH") return json([{ id: 99 }]);
        if (method === "POST") return json([{ id: 1 }]);
        return json([]);
      }),
    );

    const hasil = await simpanPenjualan({
      ...PENJUALAN,
      usedDeposit: 10_000,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    /* Transaksi tetap tersimpan */
    expect(hasil.id).toBe(99);
    expect(hasil.struk.usedDeposit).toBe(10_000);
    /* Ada peringatan */
    expect(hasil.peringatanDeposit).toBeDefined();
    expect(hasil.peringatanDeposit!).toContain("deposit");

    /* deposit_ledger tidak tercatat karena update deposit gagal */
    const ledger = depositPanggil.filter(
      (p) => p.method === "POST" && p.url.includes("/rest/v1/deposit_ledger"),
    );
    expect(ledger).toHaveLength(0);
  });

  it("customerId diprioritaskan walau nama alias/free text", async () => {
    depositPanggil.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        depositPanggil.push({ url: String(url), method, body });
        const u = String(url);
        const json = (d: unknown, status = 200) =>
          new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

        if (method === "GET" && u.includes("/sales?")) return json([]);
        /* customerId=3 → cari lewat id, bukan name */
        if (method === "GET" && u.includes("id=eq.3")) return json([{ id: 3, name: "Bhaskara VII", deposit_balance: 80_000 }]);
        if (method === "GET" && (u.includes("/rest/v1/customers") || u.includes("name=eq.")))
          return json([]); /* name lookup kosong — nama free text tidak dikenal */
        if (method === "GET") return json([]);
        if (method === "POST" && (u.endsWith("/sales") || u.includes("/sales?")))
          return json([{ id: 42 }]);
        if (method === "POST" && u.includes("/sale_items")) return json([{ id: 1 }]);
        if (method === "PATCH" && u.includes("/rest/v1/customers"))
          return json([{ id: 3 }]);
        if (method === "PATCH") return json([{ id: 99 }]);
        if (method === "POST") return json([{ id: 1 }]);
        return json([]);
      }),
    );

    const hasil = await simpanPenjualan({
      ...PENJUALAN,
      customer: "Alias tak dikenal",  /* name lookup akan gagal */
      customerId: 3,                  /* tapi id ini yang dipakai */
      usedDeposit: 30_000,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    expect(hasil.id).toBe(42);
    expect(hasil.struk.usedDeposit).toBe(30_000);

    /* Deduction menggunakan customer id=3 */
    const getCustomer = depositPanggil.find(
      (p) => p.method === "GET" && p.url.includes("id=eq.3"),
    );
    expect(getCustomer).toBeDefined();

    const patchCustomers = depositPanggil.filter(
      (p) => p.method === "PATCH" && p.url.includes("/rest/v1/customers") && p.body.deposit_balance !== undefined,
    );
    expect(patchCustomers).toHaveLength(1);
    /* 80.000 - 30.000 = 50.000 */
    expect(patchCustomers[0].body.deposit_balance).toBe(50_000);
    expect(hasil.peringatanDeposit).toBeUndefined();
  });

  it("lookup nama ber-spasi tidak double-encode URL", async () => {
    tiruServerDeposit();
    await simpanPenjualan({
      ...PENJUALAN,
      customer: "Gimo Gg 3 - Bhaskara 3/10",
      usedDeposit: 10_000,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    /* Bug produksi: `searchParams.set("name", \`eq.${encodeURIComponent(n)}\`)`
       di-encode dua kali, jadi PostgREST menerima "Gimo%2520Gg%..." dan
       tidak menemukan customer — deposit tidak pernah terpotong dan tidak
       ada yang tahu. Ceknya: decode sekali harus menghasilkan nama persis. */
    const getByName = depositPanggil.find(
      (p) => p.method === "GET" && p.url.includes("name=eq."),
    );
    expect(getByName).toBeDefined();
    const namaDiUrl = new URL(getByName!.url).searchParams.get("name");
    expect(namaDiUrl).toBe("eq.Gimo Gg 3 - Bhaskara 3/10");

    /* Dan pengurangan tetap jalan */
    const patchDeposit = depositPanggil.find(
      (p) => p.method === "PATCH" && p.url.includes("/rest/v1/customers") && p.body.deposit_balance !== undefined,
    );
    expect(patchDeposit).toBeDefined();
  });

  it("customer tidak ditemukan → peringatan, bukan diam", async () => {
    depositPanggil.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        depositPanggil.push({ url: String(url), method, body });
        const u = String(url);
        const json = (d: unknown, status = 200) =>
          new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

        if (method === "GET" && u.includes("/sales?")) return json([]);
        /* Lookup customer selalu kosong — nama tidak dikenal dan tidak ada customerId */
        if (method === "GET" && u.includes("/rest/v1/customers")) return json([]);
        if (method === "GET") return json([]);
        if (method === "POST" && (u.endsWith("/sales") || u.includes("/sales?")))
          return json([{ id: 99 }]);
        if (method === "POST" && u.includes("/sale_items")) return json([{ id: 1 }]);
        if (method === "PATCH") return json([{ id: 99 }]);
        if (method === "POST") return json([{ id: 1 }]);
        return json([]);
      }),
    );

    const hasil = await simpanPenjualan({
      ...PENJUALAN,
      customer: "Nama Asing",
      usedDeposit: 5_000,
      completedAt: new Date("2026-10-16T04:00:00Z"),
    });

    /* Struk tetap tersimpan, tapi kasir TAHU depositnya tidak terpotong */
    expect(hasil.id).toBe(99);
    expect(hasil.peringatanDeposit).toBeDefined();
    expect(hasil.peringatanDeposit!).toContain("deposit");

    const ledger = depositPanggil.filter(
      (p) => p.method === "POST" && p.url.includes("deposit_ledger"),
    );
    expect(ledger).toHaveLength(0);
  });
});