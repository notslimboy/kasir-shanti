import { describe, expect, it } from "vitest";

import { delayDaftar } from "./list-motion";

/* Stagger tanpa batas atas = katalog 1.095 produk, baris ke-200 selesai
   3 detik setelah mengetik. Batas atas ini yang jaga supaya daftar tetap
   terasa responsif. */

describe("delayDaftar", () => {
  it("naik bertahap 15ms per item", () => {
    expect(delayDaftar(0, false)).toBe(0);
    expect(delayDaftar(1, false)).toBeCloseTo(0.015);
    expect(delayDaftar(4, false)).toBeCloseTo(0.06);
  });

  it("berhenti di batas atas, bukan lanjut semua item", () => {
    expect(delayDaftar(14, false)).toBeCloseTo(0.21);
    expect(delayDaftar(500, false)).toBe(delayDaftar(200, false));
  });

  it("tanpa delay saat pengguna minta kurangi gerakan", () => {
    expect(delayDaftar(9, true)).toBe(0);
    expect(delayDaftar(9, null)).toBeCloseTo(0.135); // belum selesai dibaca
  });
});