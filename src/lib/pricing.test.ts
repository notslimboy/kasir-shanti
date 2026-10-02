import { describe, expect, it } from "vitest";
import {
  MIN_HALF_PRICE,
  ceilHalf,
  halfFloorBump,
  halfHitsFloor,
  halfVariantPrice,
  rupiahNumber,
  isHalfVariantName,
} from "./pricing";

/* Port dari server.py. Kalau aturan ini berubah di server, test ini harus gagal. */

describe("rupiahNumber", () => {
  it("mengambil angka dari string berformat", () => {
    expect(rupiahNumber("Rp 18.000")).toBe(18_000);
    expect(rupiahNumber(18_000)).toBe(18_000);
    expect(rupiahNumber("")).toBe(0);
    expect(rupiahNumber("abc")).toBe(0);
  });
});

describe("ceilHalf", () => {
  it("membulatkan ke atas, bukan ke terdekat", () => {
    expect(ceilHalf(35_000)).toBe(17_500);
    expect(ceilHalf(35_001)).toBe(17_501);
    expect(ceilHalf(1)).toBe(1);
    expect(ceilHalf(0)).toBe(0);
  });
});

describe("halfVariantPrice", () => {
  it("setengah dari harga normal", () => {
    expect(halfVariantPrice(30_000)).toBe(15_000);
    expect(halfVariantPrice(35_000)).toBe(17_500);
    expect(halfVariantPrice(28_000)).toBe(14_000);
  });

  it("dinaikkan ke Rp 10.000 kalau di bawah", () => {
    expect(halfVariantPrice(18_000)).toBe(MIN_HALF_PRICE); // 9.000 -> 10.000
    expect(halfVariantPrice(10_000)).toBe(MIN_HALF_PRICE); // 5.000 -> 10.000
    expect(halfVariantPrice(1_000)).toBe(MIN_HALF_PRICE);
    expect(halfVariantPrice(0)).toBe(MIN_HALF_PRICE);
  });

  it("tidak menyentuh harga yang sudah di atas lantai", () => {
    expect(halfVariantPrice(20_000)).toBe(10_000);
    expect(halfVariantPrice(20_001)).toBe(10_001);
  });
});

describe("halfHitsFloor", () => {
  it("memberi tahu saat aturan minimum aktif", () => {
    expect(halfHitsFloor(18_000)).toBe(true);
    // 19.998 -> ceil 9.999 -> naik ke 10.000 (pakai floor)
    expect(halfHitsFloor(19_998)).toBe(true);
    // 19.999 -> ceil 10.000 -> sudah pas, floor tidak menaikkan apa pun
    expect(halfHitsFloor(19_999)).toBe(false);
    expect(halfHitsFloor(20_000)).toBe(false);
  });

  it("menghitung berapa yang dinaikkan", () => {
    expect(halfFloorBump(18_000)).toBe(1_000); // 9.000 -> 10.000
    expect(halfFloorBump(10_000)).toBe(5_000);
    expect(halfFloorBump(30_000)).toBe(0);
  });
});

describe("isHalfVariantName", () => {
  it("mengenali semua ejaan separuh", () => {
    expect(isHalfVariantName("Separuh")).toBe(true);
    expect(isHalfVariantName("separuh")).toBe(true);
    expect(isHalfVariantName("1/2")).toBe(true);
    expect(isHalfVariantName("setengah")).toBe(true);
    expect(isHalfVariantName("Jumbo")).toBe(false);
  });
});
