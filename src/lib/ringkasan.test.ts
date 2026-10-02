import { describe, expect, it } from "vitest";

import { mundur, persenPerubahan, ringkasanDari, totalOngkir } from "./ringkasan";
import type { SaleRow } from "@/supabase/types";

/* Angka di Beranda dipakai untuk memutuskan jam buka/tutup. Salah hitung di
   sini berarti orang datang ke tempat yang sudah tutup. */

const s = (p: Partial<SaleRow>): SaleRow => ({
  id: 1,
  receipt_no: "SH-1",
  completed_at: "2026-09-30T05:00:00.000+00:00",
  store_name: "Shanti Catering",
  payment: "Tunai",
  subtotal: 100_000,
  discount: 0,
  tax: 0,
  total: 100_000,
  customer_name: "Budi",
  customer_address: "",
  order_note: "",
  due_text: "",
  chat_date: "",
  deleted_at: null,
  stock_restored_on_delete: 0,
  paid_amount: 0,
  created_at: "2026-09-30T05:00:00.000+00:00",
  queue_no: 1,
  queue_date: "2026-09-30",
  send_note: "",
  ...p,
});

const HARI_INI = "2026-09-30";

describe("mundur", () => {
  it("mundur di dalam bulan", () => {
    expect(mundur("2026-09-30", 1)).toBe("2026-09-29");
  });

  it("mundur lintas bulan", () => {
    expect(mundur("2026-09-01", 1)).toBe("2026-08-31");
  });

  it("mundur lintas tahun", () => {
    expect(mundur("2026-01-01", 1)).toBe("2025-12-31");
  });

  it("mundur nol tidak mengubah", () => {
    expect(mundur("2026-09-30", 0)).toBe("2026-09-30");
  });
});

describe("ringkasanDari", () => {
  it("menghitung omset & transaksi hari ini saja", () => {
    const r = ringkasanDari(
      [
        s({ id: 1, total: 100_000 }),
        s({ id: 2, total: 50_000, completed_at: "2026-09-30T08:00:00.000+00:00" }),
        s({ id: 3, total: 999_000, completed_at: "2026-09-28T08:00:00.000+00:00" }),
      ],
      HARI_INI,
    );
    expect(r.hariIni.omset).toBe(150_000);
    expect(r.hariIni.transaksi).toBe(2);
    expect(r.bulanIni.omset).toBe(1_149_000);
  });

  it("struk dihapus tidak dihitung sama sekali", () => {
    const r = ringkasanDari(
      [
        s({ id: 1, total: 100_000 }),
        s({ id: 2, total: 700_000, deleted_at: "2026-09-30T09:00:00.000+00:00" }),
      ],
      HARI_INI,
    );
    expect(r.hariIni.omset).toBe(100_000);
    expect(r.bulanIni.transaksi).toBe(1);
  });

  it("minggu ini = 7 hari terakhir, termasuk hari ini", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      s({ id: i, total: 10_000, completed_at: `2026-09-${String(30 - i).padStart(2, "0")}T05:00:00.000+00:00` }),
    );
    const r = ringkasanDari(rows, HARI_INI);
    // 30, 29, 28, 27, 26, 25, 24 = 7 hari. Sisanya (23 ke bawah) di luar.
    expect(r.mingguIni.transaksi).toBe(7);
    expect(r.mingguIni.omset).toBe(70_000);
  });

  it("piutang = struk belum lunas, nominal = total − dibayar", () => {
    const r = ringkasanDari(
      [
        s({ id: 1, total: 100_000, paid_amount: 0 }),
        s({ id: 2, total: 200_000, paid_amount: 200_000 }),
        s({ id: 3, total: 50_000, paid_amount: 20_000 }),
      ],
      HARI_INI,
    );
    expect(r.piutang.count).toBe(2);
    expect(r.piutang.nominal).toBe(100_000 + 30_000);
  });

  it("tren selalu punya jumlah hari yang diminta, termasuk hari kosong", () => {
    const r = ringkasanDari([s({})], HARI_INI, 30);
    expect(r.tren).toHaveLength(30);
    // Hari tanpa transaksi tetap ada, dengan angka nol — kalau dihilangkan,
    // garis tren akan melompati tanggal dan terlihat salah.
    expect(r.tren.filter((t) => t.omset === 0).length).toBe(29);
  });

  it("tren 7 hari urut dari yang lama ke yang baru", () => {
    const r = ringkasanDari([], HARI_INI, 7);
    expect(r.tren.map((t) => t.d)).toEqual(["24", "25", "26", "27", "28", "29", "30"]);
  });

  it("metode pembayaran diurut dari yang terbesar, persen benar", () => {
    const r = ringkasanDari(
      [
        s({ id: 1, total: 75_000, payment: "Tunai" }),
        s({ id: 2, total: 25_000, payment: "QRIS" }),
      ],
      HARI_INI,
    );
    expect(r.metodePembayaran[0]).toEqual({ name: "Tunai", total: 75_000, pct: 75 });
    expect(r.metodePembayaran[1]).toEqual({ name: "QRIS", total: 25_000, pct: 25 });
  });

  it("tidak ada struk = nol semua, bukan NaN", () => {
    const r = ringkasanDari([], HARI_INI);
    expect(r.hariIni).toEqual({ omset: 0, transaksi: 0, item: 0 });
    expect(r.piutang).toEqual({ nominal: 0, count: 0 });
    expect(r.metodePembayaran).toEqual([]);
    expect(r.tren).toHaveLength(30);
  });
});

describe("totalOngkir", () => {
  it("menjumlahkan ongkir sisa dari setiap struk", () => {
    const t = totalOngkir([
      s({ id: 1, subtotal: 100_000, total: 110_000 }),
      s({ id: 2, subtotal: 100_000, discount: 10_000, total: 110_000 }), // ongkir 10.000
      s({ id: 3, subtotal: 100_000, total: 900_000, deleted_at: "2026-09-30T00:00:00Z" }),
    ]);
    expect(t).toBe(20_000);
  });
});

describe("persenPerubahan", () => {
  it("naik, turun, dan nol", () => {
    expect(persenPerubahan(110, 100)).toBe(10);
    expect(persenPerubahan(90, 100)).toBe(-10);
    expect(persenPerubahan(0, 100)).toBe(-100);
  });

  it("dari nol tidak menghasilkan Infinity", () => {
    expect(persenPerubahan(50, 0)).toBe(100);
    expect(persenPerubahan(0, 0)).toBe(0);
  });
});
