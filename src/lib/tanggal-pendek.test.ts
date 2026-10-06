import { describe, expect, it } from "vitest";

import { tanggalPendekKeWaktu } from "@/lib/tanggal-pendek";

/* `Customer.lastOrder` datang dari `labelTanggalPendek`, yaitu
   "4 Juli 2026" — atau "—" kalau customer belum pernah order. Kolom
   "Order Terakhir" diurutkan dengan nilai balik bentuk string itu, jadi
   kasus di bawah adalah persis yang bisa muncul di tabel. */
describe("tanggalPendekKeWaktu", () => {
  it("mengubah tanggal Indonesia jadi Date", () => {
    const t = tanggalPendekKeWaktu("4 Juli 2026");
    expect(t).toBeInstanceOf(Date);
    expect(t?.getFullYear()).toBe(2026);
    expect(t?.getMonth()).toBe(6);
    expect(t?.getDate()).toBe(4);
  });

  it("membaca kedua belas dengan benar, bukan digit pertama", () => {
    expect(tanggalPendekKeWaktu("30 September 2026")?.getDate()).toBe(30);
    expect(tanggalPendekKeWaktu("1 Desember 2026")?.getMonth()).toBe(11);
  });

  /* Inilah alasan modul ini ada. Tanpa parsing, "4 Juli 2026" dan
     "30 September 2026" dibandingkan sebagai string dan "4" selalu lebih
     kecil dari "3" — urutan naiknya terbalik. */
  it("mengurutkan 4 Juli sebelum 30 September, bukan sesudahnya", () => {
    const t = tanggalPendekKeWaktu("4 Juli 2026")!;
    const u = tanggalPendekKeWaktu("30 September 2026")!;
    expect(t.getTime()).toBeLessThan(u.getTime());
    expect("4 Juli 2026".localeCompare("30 September 2026", "id-ID")).toBeGreaterThan(0);
  });

  it("menerima bentuk yang pakai jam", () => {
    expect(tanggalPendekKeWaktu("4 Juli 2026, 14:01")?.getDate()).toBe(4);
  });

  it("menjadi null untuk tempat kosong, bukan Date yang salah", () => {
    expect(tanggalPendekKeWaktu("—")).toBeNull();
    expect(tanggalPendekKeWaktu("")).toBeNull();
    expect(tanggalPendekKeWaktu("   ")).toBeNull();
    expect(tanggalPendekKeWaktu(null)).toBeNull();
    expect(tanggalPendekKeWaktu(undefined)).toBeNull();
  });

  it("menjadi null untuk bulan yang tidak dikenal", () => {
    expect(tanggalPendekKeWaktu("4 Juliy 2026")).toBeNull();
    expect(tanggalPendekKeWaktu("2026-07-04")).toBeNull();
    expect(tanggalPendekKeWaktu("Kemarin")).toBeNull();
  });
});