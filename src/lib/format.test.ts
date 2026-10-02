import { describe, expect, it } from "vitest";

import { formatRibuan, parseRibuan } from "./format";

/* Pemisah ribuan bukan hiasan: "25000" dan "250000" sama-sama lima digit,
   dan salah baca nol berarti ongkir 100x lipat. */

describe("formatRibuan", () => {
  it("pisah ribuan pakai titik", () => {
    expect(formatRibuan(25000)).toBe("25.000");
    expect(formatRibuan(250000)).toBe("250.000");
    expect(formatRibuan(1000000)).toBe("1.000.000");
    expect(formatRibuan(1234567)).toBe("1.234.567");
  });

  it("angka di bawah ribu tetap polos", () => {
    expect(formatRibuan(500)).toBe("500");
    expect(formatRibuan(9)).toBe("9");
  });

  it("nol dan negatif jadi kosong, bukan '0' atau '-5'", () => {
    /* "0" di dalam kotak berarti kasir harus menghapusnya dulu sebelum
       bisa mengetik angka. Kosong lebih jujur: belum ada nilai. */
    expect(formatRibuan(0)).toBe("");
    expect(formatRibuan(-5)).toBe("");
  });
});

describe("parseRibuan", () => {
  it("angka polos jadi angka", () => {
    expect(parseRibuan("25000")).toBe(25000);
    expect(parseRibuan("0")).toBe(0);
  });

  it("pemisah yang sudah ada diabaikan", () => {
    expect(parseRibuan("25.000")).toBe(25000);
    expect(parseRibuan("1.000.000")).toBe(1000000);
    /* Koma tidak jadi desimal: rupiah tidak punya sen, dan "25,000" yang
       diabaikan koma-nya jadi 25000 bukan 25. */
    expect(parseRibuan("25,000")).toBe(25000);
  });

  it("toleran terhadap 'Rp' dan spasi hasil salin-tempel", () => {
    expect(parseRibuan("Rp 25.000")).toBe(25000);
    expect(parseRibuan("25 000")).toBe(25000);
  });

  it("teks kosong dan huruf jadi 0, bukan NaN", () => {
    expect(parseRibuan("")).toBe(0);
    expect(parseRibuan("   ")).toBe(0);
    expect(parseRibuan("abc")).toBe(0);
    expect(parseRibuan(undefined as unknown as string)).toBe(0);
  });

  it("bolak-balik dengan format tidak mengubah angka", () => {
    for (const n of [0, 9, 500, 25000, 250000, 1000000, 123456789]) {
      if (n === 0) continue;
      expect(parseRibuan(formatRibuan(n))).toBe(n);
    }
  });
});