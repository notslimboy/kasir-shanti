import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { simpanPesananImpor } from "./simpan-impor";
import type { ItemImpor, PesananImpor } from "./impor-pesanan";

/* Tanggal proses memakai jam lokal mesin, jadi test ini membekukan Date
   supaya "hari ini" tidak bergeser antara assertion. */
const BEKU = new Date("2026-10-02T09:15:00.000Z");

const item = (nama: string, harga: number, qty = 1): ItemImpor => ({
  nama,
  harga,
  qty,
  hargaKosong: false,
  productClientId: "p1",
  productName: nama,
  perluCekHarga: false,
  stok: null,
  catatan: "",
  varian: "Normal",
  sku: "",
  baris: 1,
});

const pesanan = (p: Partial<PesananImpor> = {}): PesananImpor => ({
  customer: "Bu Ani",
  /* Tanggal chat sengaja LAMPAU: struk harus tetap diletakkan di hari
     proses, bukan di hari chat. */
  tanggal: "2026-09-24",
  jam: "07:51",
  completedAt: "2026-09-24T00:51:00.000Z",
  payment: "Tunai",
  ongkir: 20_000,
  sendNote: "",
  items: [item("Nasi Goreng", 100_000)],
  subtotal: 100_000,
  total: 120_000,
  baris: 2,
  ...p,
});

/* Panggilan POST sales/sale_items yang dicatat, supaya test bisa asserting
   payload yang benar-benar dikirim. */
let terkirim: { url: string; body: Record<string, unknown> }[] = [];

function Pasang({
  nomorStruk = "SH-20261002-0007",
  antreanTerakhir = 0,
}: { nomorStruk?: string; antreanTerakhir?: number } = {}) {
  terkirim = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      terkirim.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json([{ id: 1 }]);
    }
    if (url.includes("select=receipt_no")) return Response.json([{ receipt_no: nomorStruk }]);
    if (url.includes("select=queue_no")) return Response.json([{ queue_no: antreanTerakhir }]);
    return Response.json([]);
  });
}

const sales = () => terkirim.filter((t) => t.url.includes("/rest/v1/sales?"));
const items = () => terkirim.filter((t) => t.url.includes("/rest/v1/sale_items"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BEKU);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tanggal struk hasil import", () => {
  it("memakai hari proses, bukan tanggal chat — struk harus muncul di Dashboard Penjualan hari ini", async () => {
    Pasang();
    const r = await simpanPesananImpor([pesanan()]);

    const kirim = sales()[0].body;
    /* Versi lama melakukan hal yang sama: buildSalePayloadFromDraft(draft,
       new Date()). Tanpa ini, struk 24 Sep yang diimpor 2 Okt tidak pernah
       muncul di tab Harian (= hari ini) dan kasir mengira datanya hilang. */
    expect(kirim.completed_at).toBe(BEKU.toISOString());
    expect(r.tanggalProses).toBe("2026-10-02");
    /* Tanggal chat tidak hilang — tetap disimpan & dicetak sebagai
       keterangan. */
    expect(kirim.chat_date).toBe("2026-09-24");
  });

  it("nomor struk memakai prefix hari proses dan lanjut dari nomor terbesar hari itu", async () => {
    Pasang({ nomorStruk: "SH-20261002-0007" });
    const r = await simpanPesananImpor([pesanan(), pesanan({ baris: 5 }), pesanan({ baris: 9 })]);

    expect(r.struk.map((s) => s.receiptNo)).toEqual([
      "SH-20261002-0008",
      "SH-20261002-0009",
      "SH-20261002-0010",
    ]);
  });

  it("satu batch memakai satu waktu proses, walau tanggal chat-nya beda-beda", async () => {
    Pasang();
    await simpanPesananImpor([
      pesanan({ tanggal: "2026-09-23" }),
      pesanan({ tanggal: "2026-09-24", baris: 6 }),
    ]);
    const waktu = sales().map((s) => s.body.completed_at);
    expect(waktu[0]).toBe(waktu[1]);
  });
});

describe("nomor antrean", () => {
  it("mulai dari 'Nomor awal' saat belum ada struk hari itu", async () => {
    Pasang({ antreanTerakhir: 0 });
    const r = await simpanPesananImpor([pesanan(), pesanan({ baris: 5 })], { mulaiNo: 7 });

    expect(r.struk.map((s) => s.queueNo)).toEqual([7, 8]);
    expect(sales()[0].body.queue_date).toBe("2026-10-02");
  });

  it("tidak menabrak nomor antrean struk Kasir yang sudah ada hari ini", async () => {
    /* KOT mengelompokkan per (tanggal, no). Nomor yang bentrok berarti dua
       pesanan berbeda gabung jadi satu tiket dapur. */
    Pasang({ antreanTerakhir: 4 });
    const r = await simpanPesananImpor([pesanan()], { mulaiNo: 2 });

    expect(r.struk[0].queueNo).toBe(5);
  });
});

describe("isi struk", () => {
  it("ongkir ditulis ke kolom discount, sama seperti versi lama & Kasir", async () => {
    Pasang();
    await simpanPesananImpor([pesanan({ ongkir: 20_000, subtotal: 100_000, total: 120_000 })]);

    const kirim = sales()[0].body;
    expect(kirim.subtotal).toBe(100_000);
    expect(kirim.discount).toBe(20_000);
    /* Pembacaan ongkir = total − subtotal, jadi discount harus salinan,
       bukan addition: kalau subtotal sudah termasuk ongkir, kolom ini
       membuat ongkir terhitung dua kali. */
    expect(Number(kirim.total) - Number(kirim.subtotal)).toBe(kirim.discount);
  });

  it("item ikut tersimpan, dan struk baliknya untuk dicetak", async () => {
    Pasang();
    const r = await simpanPesananImpor([pesanan()]);

    expect(items()).toHaveLength(1);
    const baris = items()[0].body as unknown as { sale_id: number; name: string; line_total: number }[];
    expect(baris[0].sale_id).toBe(1);
    expect(baris[0].line_total).toBe(100_000);
    expect(r.tersimpan).toBe(1);
    expect(r.struk).toHaveLength(1);
  });

  it("struk hasil impor lahir belum lunas, sama seperti Kasir", async () => {
    /* Dua jalur tulis harus sepakat. Kalau impor menulis `paid_amount: total`
       sementara Kasir menulis 0, status awal sebuah struk bergantung pada
       dari mana ia dibuat — dan piutang hasil impor hilang tanpa jejak. */
    Pasang();
    await simpanPesananImpor([pesanan({ total: 120_000 })]);

    const kirim = sales()[0].body;
    expect(kirim.paid_amount).toBe(0);
    expect(kirim.total).toBe(120_000);
  });
});

describe("pelaporan proses", () => {
  it("onProgress dipanggil 0/N lalu tiap struk selesai", async () => {
    Pasang();
    const langkah: string[] = [];
    await simpanPesananImpor([pesanan(), pesanan({ baris: 5 }), pesanan({ baris: 8 })], {
      onProgress: (selesai, total) => langkah.push(`${selesai}/${total}`),
    });
    expect(langkah).toEqual(["0/3", "1/3", "2/3", "3/3"]);
  });

  it("struk tanpa tanggal tetap dilaporkan, bukan diam-diam dilewati", async () => {
    Pasang();
    const r = await simpanPesananImpor([pesanan({ tanggal: "" }), pesanan({ baris: 5 })]);

    expect(r.tersimpan).toBe(1);
    expect(r.gagal).toBe(1);
    expect(r.pesan[0]).toContain("tidak terbaca");
  });

  it("item gagal = struk tetap ada tapi diberi tahu, dan tidak ikut dicetak", async () => {
    Pasang();
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("sale_items")) {
        return new Response("boom", { status: 500 });
      }
      if (init?.method === "POST") {
        terkirim.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return Response.json([{ id: 1 }]);
      }
      if (url.includes("select=receipt_no")) return Response.json([{ receipt_no: "SH-20261002-0007" }]);
      if (url.includes("select=queue_no")) return Response.json([{ queue_no: 0 }]);
      return Response.json([]);
    });

    const r = await simpanPesananImpor([pesanan()]);
    expect(r.tersimpan).toBe(1);
    expect(r.gagal).toBe(1);
    expect(r.struk).toHaveLength(0);
    expect(r.pesan[0]).toContain("item GAGAL");
  });
});
