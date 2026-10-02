import { describe, expect, it } from "vitest";

import {
  filterPiutang,
  formatNominal,
  keNominal,
  penyesuaianDeposit,
  sisaPiutang,
  statusPiutang,
  totalSisaPiutang,
  type BarisPiutang,
} from "./piutang";

/* Aturan piutang ini disalin dari script.js lama. Testnya mengunci supaya
   pembulatan atau penyederhanaan tidak mengubah arti uang di tabel ini. */

const struk = (p: Partial<{ total: number; paid_amount: number; deleted_at: string | null }>) => ({
  total: 0,
  paid_amount: 0,
  deleted_at: null,
  ...p,
});

describe("sisaPiutang", () => {
  it("total dikurangi yang sudah dibayar", () => {
    expect(sisaPiutang(struk({ total: 200_000, paid_amount: 50_000 }))).toBe(150_000);
  });

  it("nilai bukan angka diabaikan, bukan jadi NaN", () => {
    expect(sisaPiutang({ total: Number.NaN, paid_amount: 0 })).toBe(0);
  });
});

describe("statusPiutang", () => {
  it("lunas hanya kalau total benar-benar lebih besar dari 0", () => {
    expect(statusPiutang(struk({ total: 200_000, paid_amount: 200_000 }))).toBe("lunas");
    expect(statusPiutang(struk({ total: 0, paid_amount: 0 }))).toBe("belum");
  });

  it("sebagian kalau sudah ada pembayaran tapi belum penuh", () => {
    expect(statusPiutang(struk({ total: 200_000, paid_amount: 50_000 }))).toBe("sebagian");
  });

  it("belum kalau belum bayar sama sekali", () => {
    expect(statusPiutang(struk({ total: 200_000, paid_amount: 0 }))).toBe("belum");
  });

  it("terhapus menang atas apa pun", () => {
    expect(statusDariTerhapus()).toBe("terhapus");
  });
});

function statusDariTerhapus() {
  return statusPiutang(struk({ total: 200_000, paid_amount: 200_000, deleted_at: "2026-10-02T03:00:00Z" }));
}

const baris = (p: Partial<BarisPiutang>): BarisPiutang => ({
  saleId: 1,
  customer: "Bu Ani",
  tag: "",
  invoice: "INV-1",
  date: "2026-10-02",
  total: 100_000,
  paid: 0,
  sisa: 100_000,
  status: "belum",
  courier: "",
  umurHari: 3,
  ...p,
});

describe("filterPiutang", () => {
  const data = [
    baris({ saleId: 1, status: "belum" }),
    baris({ saleId: 2, status: "lunas", paid: 100_000, sisa: 0, invoice: "INV-2", customer: "Pak Santi" }),
    baris({ saleId: 3, status: "sebagian", paid: 40_000, sisa: 60_000, customer: "Pak Budi" }),
  ];

  it("tab belum_wpicks everything except lunas", () => {
    expect(filterPiutang(data, "belum", "").map((b) => b.saleId)).toEqual([1, 3]);
  });

  it("tab lunas hanya yang lunas", () => {
    expect(filterPiutang(data, "lunas", "").map((b) => b.saleId)).toEqual([2]);
  });

  it("semua tidak memfilter status", () => {
    expect(filterPiutang(data, "semua", "")).toHaveLength(3);
  });

  it("pencarian cocok ke nama customer maupun nomor struk", () => {
    expect(filterPiutang(data, "semua", "budi").map((b) => b.saleId)).toEqual([3]);
    expect(filterPiutang(data, "semua", "inv-2").map((b) => b.saleId)).toEqual([2]);
  });

  it("huruf besar di pencarian diabaikan", () => {
    expect(filterPiutang(data, "semua", "BU ANI").map((b) => b.saleId)).toEqual([1]);
  });
});

describe("totalSisaPiutang", () => {
  it("menjumlahkan sisa, bukan total tagihan", () => {
    expect(
      totalSisaPiutang([
        baris({ saleId: 1, sisa: 100_000 }),
        baris({ saleId: 2, sisa: 60_000, status: "sebagian" }),
      ]),
    ).toBe(160_000);
  });

  it("struk lunas tidak menambah apa pun", () => {
    expect(
      totalSisaPiutang([
        baris({ saleId: 1, status: "lunas", sisa: 0 }),
        baris({ saleId: 2, status: "sebagian", sisa: 60_000 }),
      ]),
    ).toBe(60_000);
  });
});

describe("penyesuaianDeposit", () => {
  it("potong deposit dulu kembali ke customer saat dibatalkan", () => {
    expect(
      penyesuaianDeposit([
        { amount: 50_000, note: "Otomatis Potong Deposit" },
        { amount: 20_000, note: "Pembayaran cicilan manual" },
      ]),
    ).toBe(50_000);
  });

  it("kelebihan bayar dikeluarkan lagi dari deposit", () => {
    expect(
      penyesuaianDeposit([
        { amount: 120_000, note: "Pembayaran cicilan manual: Bayar Rp 120.000 (Kelebihan Rp 20.000 masuk deposit)" },
      ]),
    ).toBe(-20_000);
  });

  it("kombinasi dua arah dijumlahkan", () => {
    expect(
      penyesuaianDeposit([
        { amount: 50_000, note: "Otomatis Potong Deposit" },
        { amount: 120_000, note: "Pelunasan cepat: Bayar Rp 120.000 (Kelebihan Rp 20.000 masuk deposit)" },
      ]),
    ).toBe(30_000);
  });

  it("catatan tanpa efek deposit diabaikan", () => {
    expect(penyesuaianDeposit([{ amount: 100_000, note: "Pelunasan cepat" }])).toBe(0);
    expect(penyesuaianDeposit([{ amount: 100_000, note: "" }])).toBe(0);
  });
});

describe("nominal", () => {
  it("pemisah ribuan id-ID dibaca sebagai angka", () => {
    expect(keNominal("50.000")).toBe(50_000);
    expect(keNominal("1.250.500")).toBe(1_250_500);
  });

  it("prefix Rp dan teks lain tidak menggigit", () => {
    expect(keNominal("Rp 50.000")).toBe(50_000);
    expect(keNominal("abc")).toBe(0);
    expect(keNominal("")).toBe(0);
  });

  it("input selalu kembali jadi format ribuan", () => {
    expect(formatNominal(50000)).toBe("50.000");
    expect(formatNominal(-5)).toBe("0");
  });
});