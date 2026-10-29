import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `ubahStruk` — the first write path for receipt contents.
 *
 * Before this existed, the drawer's "Simpan" only mutated local state and
 * flashed "✓ Tersimpan"; nothing reached the database. There was no function
 * to test, so the whole feature was untested by default.
 *
 * These specs assert on the requests made, not on the response, because the
 * two failure modes worth catching both happen before any server reply: a line
 * written with the wrong `id`, and a total computed from the wrong rows. */

type Panggilan = { url: string; method: string; body: Record<string, unknown> };

const panggil: Panggilan[] = [];

/** Rows the fake server claims to hold, so the pre-write read is meaningful. */
let barisLama: { total: number; paid_amount: number }[] = [{ total: 100_000, paid_amount: 100_000 }];

beforeEach(() => {
  panggil.length = 0;
  barisLama = [{ total: 100_000, paid_amount: 100_000 }];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      panggil.push({ url: String(url), method, body });

      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });

      if (method === "GET") return json(barisLama);
      if (method === "PATCH" && String(url).includes("/sales?")) {
        return json([{ id: 7, ...body }]);
      }
      if (method === "PATCH") return json([{ id: 1, ...body }]);
      /* INSERT baris baru: PostgREST menerima array body, jadi jumlah baris
         yang dikembalikan harus sama dengan yang dikirim — `ubahStruk`
         memeriksa itu untuk memastikan tidak ada item yang setengah masuk. */
      if (method === "POST") {
        const isi = Array.isArray(body) ? body : [body];
        return json(isi.map((b: Record<string, unknown>, i: number) => ({ id: 900 + i, ...b })));
      }
      /* 204 tidak boleh punya body — `new Response("", {status: 204})`
         melempar di dalam Response constructor, bukan di server. */
      if (method === "DELETE") return new Response(null, { status: 204 });
      return json([]);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const { ubahStruk, bagiBarisUbah } = await import("./supabase-tulis");

const DASAR = {
  saleId: 7,
  customer: "Uji",
  sendNote: "saos bnyakin",
  ongkir: 0,
  diskon: 0,
};

describe("ubahStruk — header", () => {
  it("menulis customer_name, send_note, subtotal, dan total", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 2, price: 20_000, note: "tanpa lombok" }],
    });

    expect(hasil.ok).toBe(true);
    const patch = panggil.find((p) => p.method === "PATCH" && p.url.includes("/sales?"));
    expect(patch).toBeDefined();
    expect(patch!.body.customer_name).toBe("Uji");
    expect(patch!.body.send_note).toBe("saos bnyakin");
    expect(patch!.body.subtotal).toBe(40_000);
    expect(patch!.body.total).toBe(40_000);
  });

  it("tidak pernah menyentuh paid_amount", async () => {
    /* paid_amount adalah uang yang benar-benar sudah masuk. Menyentuhnya di
       sini berarti "memperbaiki" pembayaran secara otomatis, dan struk lunas
       bisa jadi lunas tanpa uangnya benar-benar ada. */
    await ubahStruk({ ...DASAR, lines: [{ id: 11, qty: 1, price: 20_000, note: "" }] });
    const patch = panggil.find((p) => p.method === "PATCH" && p.url.includes("/sales?"));
    expect(patch!.body).not.toHaveProperty("paid_amount");
  });

  it("total memakai formula yang sama dengan simpanPenjualan", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      ongkir: 15_000,
      diskon: 5_000,
      lines: [{ id: 11, qty: 3, price: 35_000, note: "" }],
    });
    /* subtotal 105.000 − diskon 5.000 + ongkir 15.000 = 115.000 */
    expect(hasil.subtotal).toBe(105_000);
    expect(hasil.total).toBe(115_000);
  });

  it("total tidak pernah minus, walau diskon melebihi subtotal", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      ongkir: 0,
      diskon: 999_999,
      lines: [{ id: 11, qty: 1, price: 10_000, note: "" }],
    });
    expect(hasil.total).toBe(0);
  });

  it("NaN di harga tidak membuat seluruh total NaN", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 1, price: Number.NaN, note: "" }],
    });
    /* NaN yang lolos akan tersimpan ke `sales.total` dan menggagalkan semua
       agregasi di Beranda dan laporan — dengan angka nol, yang kelihatan. */
    expect(Number.isFinite(hasil.total)).toBe(true);
    expect(hasil.total).toBe(0);
  });
});

describe("ubahStruk — baris item", () => {
  it("PATCH per baris lewat sale_items.id, bukan nama", async () => {
    await ubahStruk({
      ...DASAR,
      lines: [
        { id: 11, qty: 1, price: 20_000, note: "" },
        { id: 12, qty: 3, price: 5_000, note: "extra sambal" },
      ],
    });

    const patchItem = panggil.filter((p) => p.method === "PATCH" && p.url.includes("/sale_items?"));
    expect(patchItem).toHaveLength(2);
    expect(patchItem[0]!.url).toContain("in.(11)");
    expect(patchItem[1]!.url).toContain("in.(12)");
  });

  it("menulis quantity, price, line_total, dan note", async () => {
    await ubahStruk({ ...DASAR, lines: [{ id: 11, qty: 3, price: 7_000, note: "  bnyak  " }] });
    const patch = panggil.find((p) => p.method === "PATCH" && p.url.includes("/sale_items?"));
    expect(patch!.body).toMatchObject({
      quantity: 3,
      price: 7_000,
      line_total: 21_000,
      /* `rapikanCatatan` — normalisasi yang sama dipakai keranjang kasir, jadi
         "  bnyak " dan "bnyak" tidak menjadi dua isi berbeda di KOT dan struk. */
      note: "bnyak",
    });
  });

  it("memakai normalisasi catatan yang sama seperti keranjang kasir", async () => {
    /* Kalau form edit dan kasir punya definisi "catatan bersih" yang berbeda,
       satu order bisa terbaca dua kali di KOT, dan tidak ada yang bisa
       mengaitkannya sebagai pesan yang sama. */
    const { rapikanCatatan } = await import("./catatan-item");
    await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 1, price: 20_000, note: "  saos   bnyakin  " }],
    });
    const patch = panggil.find((p) => p.method === "PATCH" && p.url.includes("/sale_items?"));
    expect(patch!.body.note).toBe(rapikanCatatan("  saos   bnyakin  "));
    expect(patch!.body.note).toBe("saos bnyakin");
  });

  it("baris tanpa id ditolak, bukan ditulis ke id=eq.0", async () => {
    /* PATCH `id=eq.0` yang tanpa filter cocok akan menimpa baris acak —
       termasuk struk milik orang lain. Berhenti lebih baik. */
    const hasil = await ubahStruk({ ...DASAR, lines: [{ id: 0, qty: 1, price: 1_000, note: "" }] });
    expect(hasil.ok).toBe(false);
    expect(hasil.pesan).toMatch(/tanpa id/i);
    expect(panggil.some((p) => p.url.includes("eq.0") || p.url.includes("in.(0)"))).toBe(false);
  });

  it("menolak struktur yang seluruh itemnya jadi qty 0", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 0, price: 20_000, note: "" }],
    });
    expect(hasil.ok).toBe(false);
    expect(hasil.pesan).toMatch(/tidak bisa disimpan kosong/i);
  });

  it("membuang baris qty 0 lewat DELETE, dan melaporkannya", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [
        { id: 11, qty: 2, price: 20_000, note: "" },
        { id: 12, qty: 0, price: 5_000, note: "sisa" },
      ],
    });

    expect(hasil.ok).toBe(true);
    expect(hasil.dibuang).toBe(1);

    const del = panggil.find((p) => p.method === "DELETE");
    expect(del).toBeDefined();
    expect(del!.url).toContain("in.(12)");
    /* Baris yang masih hidup tidak boleh ikut terhapus. */
    expect(del!.url).not.toContain("11");
  });

  it("baris qty 0 dihapus sebelum baris lain di-PATCH", async () => {
    /* Kalau ada yang gagal setelahnya, tidak boleh ada baris menggantung
       dengan qty 0 — struk seperti itu tercetak sia-sia dan muncul di KOT. */
    await ubahStruk({
      ...DASAR,
      lines: [
        { id: 11, qty: 1, price: 20_000, note: "" },
        { id: 12, qty: 0, price: 5_000, note: "" },
      ],
    });

    const urutan = panggil.map((p) => `${p.method} ${p.url.includes("/sales?") ? "sales" : p.url.includes("sale_items") ? "items" : p.url}`);
    const idxDelete = urutan.findIndex((u) => u.startsWith("DELETE"));
    const idxPatchItems = urutan.findIndex((u) => u.startsWith("PATCH items"));
    expect(idxDelete).toBeGreaterThanOrEqual(0);
    expect(idxPatchItems).toBeGreaterThan(idxDelete);
  });

  it("hapusIds: baris yang dihapus tombol juga di-DELETE", async () => {
    /* Tombol hapus membuang baris dari form, bukan menyetel qty 0 — tanpa
       daftar hapus eksplisit barisnya diam-diam tetap ada di sale_items. */
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 1, price: 20_000, note: "" }],
      hapusIds: [12, 13],
    });

    expect(hasil.ok).toBe(true);
    expect(hasil.dibuang).toBe(2);
    const del = panggil.find((p) => p.method === "DELETE");
    expect(del).toBeDefined();
    expect(del!.url).toContain("in.(12,13)");
    /* Subtotal/total hanya menghitung baris yang tersisa. */
    expect(hasil.subtotal).toBe(20_000);
    expect(hasil.total).toBe(20_000);
  });

  it("hapusIds dan baris qty 0 saling mencegah duplikat DELETE", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [
        { id: 11, qty: 1, price: 20_000, note: "" },
        { id: 12, qty: 0, price: 5_000, note: "" },
      ],
      hapusIds: [12],
    });

    expect(hasil.ok).toBe(true);
    /* 12 muncul sekali — hapus dua kali id yang sama tidak ada artinya. */
    const del = panggil.find((p) => p.method === "DELETE");
    expect(del!.url).toContain("in.(12)");
    expect(del!.url).not.toMatch(/12, ?12/);
    expect(hasil.dibuang).toBe(1);
  });

  it("membuang semua item: baris tersisa dan hapusIds tidak menghitung dobel", async () => {
    /* Menolaknya tetap: struk tidak boleh kosong. */
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [],
      hapusIds: [11, 12],
    });
    expect(hasil.ok).toBe(false);
    expect(hasil.pesan).toMatch(/tidak bisa disimpan kosong/i);
  });
});

describe("ubahStruk — menambah item", () => {
  const BARU = {
    id: 0,
    baru: true,
    name: "Asem Asem Daging",
    variant: "Normal",
    qty: 1,
    price: 25_000,
    note: "tanpa buncis",
    productClientId: "p-asem",
    variantClientId: "v-normal",
  };

  it("mengirim item baru lewat POST, bukan PATCH id 0", async () => {
    /* PATCH `id=eq.0` akan menimpa baris acak. Item yang ditambahkan harus
       INSERT, dan itu satu-satunya jalur yang boleh membuat baris baru. */
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 101, qty: 1, price: 35_000, note: "" }, BARU],
    });

    expect(hasil.ok).toBe(true);
    const post = panggil.find((p) => p.method === "POST" && p.url.includes("/sale_items"));
    expect(post).toBeDefined();
    const isi = post!.body as unknown as Record<string, unknown>[];
    expect(Array.isArray(isi)).toBe(true);
    expect(isi).toHaveLength(1);
    expect(isi[0]).toMatchObject({
      sale_id: 7,
      name: "Asem Asem Daging",
      menu_name: "Asem Asem Daging",
      quantity: 1,
      price: 25_000,
      line_total: 25_000,
      note: "tanpa buncis",
      product_client_id: "p-asem",
    });
    /* Baris lama tidak ikut dikirim ulang. */
    expect(panggil.some((p) => p.url.includes("in.(0)"))).toBe(false);
  });

  it("total ikut menghitung item baru", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 101, qty: 1, price: 35_000, note: "" }, BARU],
    });
    expect(hasil.subtotal).toBe(60_000);
    expect(hasil.total).toBe(60_000);
  });

  it("item baru yang qty-nya dinolkan tidak pernah ikut dikirim", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 101, qty: 1, price: 35_000, note: "" }, { ...BARU, qty: 0 }],
    });
    expect(hasil.ok).toBe(true);
    expect(hasil.dibuang).toBe(1);
    expect(panggil.some((p) => p.method === "POST")).toBe(false);
  });

  it("menolak item baru tanpa nama", async () => {
    const hasil = await ubahStruk({ ...DASAR, lines: [{ ...BARU, name: "  " }] });
    expect(hasil.ok).toBe(false);
    expect(hasil.pesan).toMatch(/tanpa nama/i);
    expect(panggil.some((p) => p.method === "POST")).toBe(false);
  });

  it("melaporkan kalau server tidak menyimpan seluruh item baru", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        panggil.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : {} });
        const json = (d: unknown) =>
          new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
        if (method === "GET") return json(barisLama);
        if (method === "POST") return json([]); // tidak ada yang tersimpan
        if (method === "DELETE") return new Response(null, { status: 204 });
        return json([{ id: 1 }]);
      }),
    );
    const hasil = await ubahStruk({ ...DASAR, lines: [BARU] });
    /* Struk yang totalnya sudah naik tapi itemnya tidak masuk adalah struk
       yang tidak bisa dijelaskan ke pelanggan. */
    expect(hasil.ok).toBe(false);
    expect(hasil.pesan).toMatch(/tidak tersimpan seluruhnya/i);
  });

  it("tetap menolak baris lama tanpa id", async () => {
    /* `baru` sengaja ditandai eksplisit: baris hasil baca yang tidak punya
       primary key juga ber-id 0, dan menebaknya sebagai baris baru berarti
       menulis ulang seluruh struknya. */
    const hasil = await ubahStruk({ ...DASAR, lines: [{ id: 0, qty: 1, price: 1_000, note: "" }] });
    expect(hasil.ok).toBe(false);
    expect(hasil.pesan).toMatch(/tanpa id/i);
  });
});

describe("bagiBarisUbah", () => {
  it("memisahkan item baru dari item yang sudah ada", () => {
    const { baru, disimpan, dibuang } = bagiBarisUbah([
      { id: 11, qty: 1, price: 1_000, note: "" },
      { id: 0, baru: true, qty: 2, price: 2_000, note: "" },
      { id: 12, qty: 0, price: 3_000, note: "" },
    ]);
    expect(baru.map((l) => l.id)).toEqual([0]);
    expect(disimpan.map((l) => l.id)).toEqual([11]);
    expect(dibuang).toBe(1);
  });
});

describe("ubahStruk — status lunas", () => {
  it("melaporkan saat total naik sehingga struk jadi belum lunas", async () => {
    /* paid_amount 100.000 vs total lama 100.000 = lunas. Naikkan harga jadi
       total 150.000: uang dibayar tidak ikut, jadi statusnya berubah. Kasir
       harus diberi tahu — kalau tidak, piutang muncul tanpa penjelasan. */
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 5, price: 30_000, note: "" }],
    });
    expect(hasil.ok).toBe(true);
    expect(hasil.total).toBe(150_000);
    expect(hasil.statusBerubah).toBe(true);
  });

  it("tidak melaporkan perubahan status kalau total turun atau sama", async () => {
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 2, price: 20_000, note: "" }],
    });
    expect(hasil.total).toBe(40_000);
    expect(hasil.statusBerubah).toBe(false);
  });

  it("tidak melaporkan perubahan status untuk struk yang belum lunas", async () => {
    barisLama = [{ total: 100_000, paid_amount: 40_000 }];
    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 5, price: 30_000, note: "" }],
    });
    /* Sudah "belum lunas" sebelum dan sesudah — tidak ada yang berubah. */
    expect(hasil.statusBerubah).toBe(false);
  });

  it("tetap menyimpan kalau gagal membaca total lama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        panggil.push({ url: String(url), method, body });
        if (method === "GET") return new Response("", { status: 500 });
        const json = (d: unknown) =>
          new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
        return json(method === "DELETE" ? undefined : [{ id: 1, ...body }]);
      }),
    );

    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 1, price: 20_000, note: "" }],
    });
    /* Gagal membaca bukan alasan memblokir penulisan — hanya berarti status
       tidak bisa dilaporkan. Menolaknya akan menjebak kasir yang sedang
       memperbaiki salah ketik. */
    expect(hasil.ok).toBe(true);
    expect(hasil.statusBerubah).toBe(false);
  });
});

describe("ubahStruk — kegagalan", () => {
  it("melaporkan kegagalan header dan tidak menyentuh baris item", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        panggil.push({ url: String(url), method, body: {} });
        if (method === "GET") {
          return new Response(JSON.stringify(barisLama), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "PATCH" && String(url).includes("/sales?")) {
          return new Response("", { status: 500 });
        }
        return new Response("[]", { headers: { "Content-Type": "application/json" } });
      }),
    );

    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 11, qty: 1, price: 20_000, note: "" }],
    });
    expect(hasil.ok).toBe(false);
    expect(panggil.some((p) => p.url.includes("sale_items"))).toBe(false);
  });

  it("PATCH tanpa baris yang cocok dianggap gagal, bukan berhasil", async () => {
    /* PostgREST membalas 200 dengan array kosong kalau filternya tidak
       kecocokan. Itu berarti tidak ada yang berubah. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        panggil.push({ url: String(url), method, body: {} });
        if (method === "GET") {
          return new Response(JSON.stringify(barisLama), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("[]", { headers: { "Content-Type": "application/json" } });
      }),
    );

    const hasil = await ubahStruk({
      ...DASAR,
      lines: [{ id: 999, qty: 1, price: 20_000, note: "" }],
    });
    expect(hasil.ok).toBe(false);
  });
});

describe("bagiBarisUbah", () => {
  it("memisahkan baris qty 0 dan menghitungnya", () => {
    const { disimpan: kept, dibuang } = bagiBarisUbah([
      { id: 1, qty: 2, price: 1_000, note: "" },
      { id: 2, qty: 0, price: 1_000, note: "" },
      { id: 3, qty: -1, price: 1_000, note: "" },
    ]);
    expect(dibuang).toBe(2);
    expect(kept.map((l) => l.id)).toEqual([1]);
  });

  it("qty negatif dianggap 0, bukan disimpan sebagai qty minus", () => {
    /* qty minus akan memperkecil total dan muncul sebagai item di KOT. */
    const { disimpan: kept, dibuang } = bagiBarisUbah([
      { id: 1, qty: -3, price: 1_000, note: "" },
    ]);
    expect(dibuang).toBe(1);
    expect(kept).toHaveLength(0);
  });
});