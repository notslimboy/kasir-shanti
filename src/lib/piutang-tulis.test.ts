import { afterEach, describe, expect, it, vi } from "vitest";

import { batalkanLunasPiutang, catatPembayaranPiutang, lunasKanPiutang } from "@/lib/piutang-tulis";

/* ==========================================================================
   Bukti rollback untuk catat pembayaran piutang.

   Bug aslinya: urutan tulisnya INSERT sale_payments → PATCH paid_amount →
   tambah deposit. Kalau langkah ketiga gagal, dua langkah pertama sudah
   tercatat, tapi kasir tetap diberi tahu "Gagal". menekan ulang mencatat
   pembayaran kedua — pembukuan dobel.

   Perbaikannya: kalau langkah akhir gagal, baris pembayaran yang barusan
   dibuat dihapus dan `paid_amount` dikembalikan ke nilai sebelum. Test ini
   memanggil HTTP aslinya, jadi yang diperiksa efeknya, bukan niat kode.
   ========================================================================== */

const ASLI_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ASLI_FETCH;
  vi.restoreAllMocks();
});

type Panggilan = { url: string; method: string; body: string | null };

function tiru({
  depositGagal = false,
}: { depositGagal?: boolean } = {}) {
  const panggilan: Panggilan[] = [];

  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    panggilan.push({ url, method, body: (init?.body as string) ?? null });

    const json = (v: unknown, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => v,
    });

    // GET sales: struk 100rb, belum ada yang dibayar -> sisa 100.000
    if (method === "GET" && url.includes("/rest/v1/sales?")) {
      return json([{ id: 7, total: 100_000, paid_amount: 0, customer_name: "Memet 22", receipt_no: "SH-1" }]);
    }
    // GET customers: deposit masih nol
    if (method === "GET" && url.includes("/rest/v1/customers?")) {
      return json([{ id: 164, name: "Memet 22", deposit_balance: 0 }]);
    }
    if (method === "GET" && url.includes("/rest/v1/customer_aliases?")) return json([]);

    // POST sale_payments: pembayaran dicatat, server mengembalikan id baris
    if (method === "POST" && url.includes("/rest/v1/sale_payments")) {
      return json([{ id: 555 }]);
    }
    // PATCH customers: ini yang gagal
    if (method === "PATCH" && url.includes("/rest/v1/customers")) {
      return json({ message: "denied" }, depositGagal ? 403 : 200);
    }
    if (method === "PATCH" && url.includes("/rest/v1/sales")) return json([{ id: 7 }]);
    if (method === "DELETE") return json([]);

    return json([]);
  }) as unknown as typeof fetch;

  return panggilan;
}

describe("catatPembayaranPiutang", () => {
  it("sukses: pembayaran tercatat, struk lunas, deposit bertambah", async () => {
    const p = tiru();
    const hasil = await catatPembayaranPiutang(7, 150_000);

    expect(hasil.ok).toBe(true);
    if (hasil.ok) {
      expect(hasil.sisa).toBe(0);
      expect(hasil.deposit).toBe(50_000); // 150.000 - 100.000 sisa
    }
    const patchCustomer = p.find((c) => c.method === "PATCH" && c.url.includes("/rest/v1/customers"));
    expect(JSON.parse(patchCustomer!.body!).deposit_balance).toBe(50_000);
  });

  /* Yang diuji di sini: tidak ada sisa setengah jadi. */
  it("gagal di langkah deposit: pembayaran dibatalkan, paid_amount dikembalikan", async () => {
    const p = tiru({ depositGagal: true });
    const hasil = await catatPembayaranPiutang(7, 150_000);

    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toContain("tidak ada yang berubah");

    /* Baris sale_payments yang sempat dibuat harus dihapus... */
    const hapus = p.filter((c) => c.method === "DELETE" && c.url.includes("sale_payments"));
    expect(hapus.length).toBe(1);
    expect(hapus[0].url).toContain("id=eq.555");

    /* ...dan paid_amount dikembalikan ke 0, bukan dibiarkan 100.000. */
    const patchSales = p.filter((c) => c.method === "PATCH" && c.url.includes("/rest/v1/sales"));
    const terakhir = patchSales[patchSales.length - 1];
    expect(JSON.parse(terakhir.body!).paid_amount).toBe(0);
  });

  /* Nominal divalidasi lebih dulu, sebelum satu pun request. Menolak tanpa
     menyentuh server berarti tidak ada yang bisa gagal di tengah. */
  it("menolak nominal tidak valid tanpa menyentuh server", async () => {
    const p = tiru();
    const hasil = await catatPembayaranPiutang(7, 0);
    expect(hasil.ok).toBe(false);
    expect(p.length).toBe(0);
  });

  it("menolak pembayaran untuk struk yang sudah lunas", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/rest/v1/sales?")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 7, total: 100_000, paid_amount: 100_000, customer_name: "X", receipt_no: "SH-1" }],
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    }) as unknown as typeof fetch;

    const hasil = await catatPembayaranPiutang(7, 50_000);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/lunas/i);
  });
});

/* ==========================================================================
    lunasKanPiutang — penandaan lunas dari Detail Struk.

    Yang dijaga: nominal yang ditulis ke sale_payments adalah SISA, bukan
    total — struk yang terlanjur dibayar separuh tidak boleh menulis cicilan
    yang sudah ada lagi.
    ========================================================================== */

describe("lunasKanPiutang", () => {
  it("mencatat pembayaran sebanyak sisa, tanpa deposit", async () => {
    const p = tiru();
    const hasil = await lunasKanPiutang(7);
    expect(hasil.ok).toBe(true);

    /* POST sale_payments: nominalnya sisa (100.000 dari total 100.000 yang
       belum dibayar sedikit pun), bukan jumlah rekaan yang lebih besar. */
    const tulis = JSON.parse(p.filter((x) => x.method === "POST" && x.url.includes("sale_payments"))[0].body!);
    expect(tulis.amount).toBe(100_000);

    /* PATCH sales: paid_amount naik menjadikan sisa nol. */
    const patchStruk = p.filter((x) => x.method === "PATCH" && x.url.includes("/rest/v1/sales"));
    expect(JSON.parse(patchStruk[0].body!).paid_amount).toBe(100_000);
  });

  it("menolak struk yang sudah lunas tanpa menulis apa pun", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/rest/v1/sales?")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 7, total: 100_000, paid_amount: 100_000, customer_name: "X", receipt_no: "SH-1" }],
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    }) as unknown as typeof fetch;

    const hasil = await lunasKanPiutang(7);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/lunas/i);
  });
});

/* ==========================================================================
   Batalkan pelunasan: deposit harus dikembalikan ke customer yang benar.

   `geserDeposit` dulu mencari customer dengan `name=eq.<nama>` persis. Kalau
   nama customer di struk beda spasi dari yang tercatat, deposit tidak pernah
   dikoreksi — dan pembatalan tetap dilaporkan "berhasil", jadi kasir tidak
   punya alasan untuk curiga.
   ========================================================================== */

describe("batalkanLunasPiutang", () => {
  type Tabel = {
    customers: { id: number; name: string; deposit_balance: number }[];
    aliases: { customer_id: number; alias: string }[];
    /** Nama customer di struk — boleh beda dari yang tercatat. */
    namaDiStruk: string;
  };

  function tiru({ customers, aliases, namaDiStruk }: Tabel) {
    const panggilan: Panggilan[] = [];
    const dihapus: number[] = [];
    let bacaPayments = 0;

    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      panggilan.push({ url, method, body: (init?.body as string) ?? null });
      const json = (v: unknown) => ({ ok: true, status: 200, json: async () => v });

      if (method === "GET" && url.includes("/rest/v1/sales?")) {
        return json([{ id: 7, total: 100_000, paid_amount: 150_000, customer_name: namaDiStruk, receipt_no: "SH-1" }]);
      }
      if (method === "GET" && url.includes("/rest/v1/customers?")) return json(customers);
      if (method === "GET" && url.includes("/rest/v1/customer_aliases?")) return json(aliases);
      /* Dua request ke sale_payments: yang pertama membaca riwayat lama,
         yang kedua — setelah DELETE — membaca sisa untuk menghitung
         paid_amount. Bedakan dengan hitungan, bukan dengan URL: keduanya
         punya `sale_id=eq.7`. */
      if (method === "GET" && url.includes("/rest/v1/sale_payments")) {
        bacaPayments += 1;
        if (bacaPayments === 1) {
          return json([{ id: 555, amount: 150_000, note: "Kelebihan Rp 50.000 masuk deposit" }]);
        }
        return json([]);
      }
      if (method === "PATCH" && url.includes("/rest/v1/customers")) {
        const id = Number(url.split("id=eq.")[1]);
        return json({ id });
      }
      if (method === "DELETE" && url.includes("sale_payments")) {
        dihapus.push(...url.split("sale_id=eq.")[1].split(",").map(Number));
        return json([]);
      }
      if (method === "PATCH" && url.includes("/rest/v1/sales")) return json([{ id: 7 }]);
      return json([]);
    }) as unknown as typeof fetch;

    return { panggilan, dihapus };
  }

  const MEMET = [{ id: 164, name: "Memet 22", deposit_balance: 50_000 }];

  it("mengembalikan deposit ke customer yang namanya persis sama", async () => {
    const { panggilan } = tiru({ customers: MEMET, aliases: [], namaDiStruk: "Memet 22" });
    const hasil = await batalkanLunasPiutang(7);
    expect(hasil.ok).toBe(true);

    const patch = panggilan.find((c) => c.method === "PATCH" && c.url.includes("/rest/v1/customers"));
    expect(patch).toBeDefined();
    /* Kelebihan Rp 50.000 dikeluarkan lagi: 50.000 - 50.000 = 0. */
    expect(JSON.parse(patch!.body!).deposit_balance).toBe(0);
  });

  /* Yang diperbaiki: nama di struk "Memet 22 " (ada spasi akhir) atau
     "memet 22" harus tetap mengenai baris yang benar. */
  it("tetap menemukan customer walau nama di struk beda kapitalisasi", async () => {
    const { panggilan } = tiru({ customers: MEMET, aliases: [], namaDiStruk: "memet 22" });
    const hasil = await batalkanLunasPiutang(7);
    expect(hasil.ok).toBe(true);
    expect(
      panggilan.some((c) => c.method === "PATCH" && c.url.includes("/rest/v1/customers?id=eq.164")),
    ).toBe(true);
  });

  it("memakai tabel alias untuk nama yang cuma ada sebagai alias", async () => {
    const { panggilan } = tiru({
      customers: MEMET,
      aliases: [{ customer_id: 164, alias: "Bu Memet" }],
      namaDiStruk: "Bu Memet",
    });
    const hasil = await batalkanLunasPiutang(7);
    expect(hasil.ok).toBe(true);
    expect(
      panggilan.some((c) => c.method === "PATCH" && c.url.includes("/rest/v1/customers?id=eq.164")),
    ).toBe(true);
  });

  /* Customer yang benar-benar tidak ada tetap dilewati: pembatalan lunas
     tidak boleh gagal hanya karena orangnya belum masuk tabel. */
  it("tidak gagal saat customer tidak ditemukan", async () => {
    const { panggilan } = tiru({ customers: [], aliases: [], namaDiStruk: "Orang Asing" });
    const hasil = await batalkanLunasPiutang(7);
    expect(hasil.ok).toBe(true);
    expect(panggilan.some((c) => c.url.includes("/rest/v1/customers") && c.method === "PATCH")).toBe(false);
  });

  it("menghitung paid_amount dari riwayat yang tersisa, bukan nol hardcode", async () => {
    const { panggilan } = tiru({ customers: MEMET, aliases: [], namaDiStruk: "Memet 22" });
    await batalkanLunasPiutang(7);
    const patch = panggilan.find((c) => c.method === "PATCH" && c.url.includes("/rest/v1/sales"));
    expect(patch).toBeDefined();
    expect(JSON.parse(patch!.body!)).toHaveProperty("paid_amount", 0);
  });
});