import { describe, expect, it } from "vitest";

import {
  barisTransaksi,
  bagiHalamanDetail,
  labelRentang,
  labelTanggal,
  perkiraanUnit,
} from "./laporan";
import type { Sale } from "./sale";

/* Bentuk laporan harus sama dengan cetakan versi lama (script.js
   salesReportA4Html). Yang diuji di sini: pemenggal halaman dan label
   tanggal — dua hal yang kalau salah, laporan tercetak dengan bentuk berbeda
   dari bulan lalu tanpa ada yang sadar. */

const struk = (p: Partial<Sale> = {}): Sale => ({
  id: 1,
  receiptNo: "X",
  customer: "Budi",
  completedOn: "2026-09-30",
  completedIso: "2026-09-30T07:00:00.000+00:00",
  completedAt: "30 September 2026, 14:01",
  completedAtShort: "30 Sep 14:01",
  total: 100_000,
  payment: "Tunai",
  itemCount: 1,
  status: "lunas",
  ongkir: 0,
  diskon: 0,
  lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 1, price: 100_000 }],
  ...p,
});

describe("perkiraanUnit", () => {
  it("tidak pernah di bawah 2 unit per struk", () => {
    // Satu struk satu item pendek = satu baris; tanpa lantai 2 unit,
    // setengah halaman bisa terisi struk minuscule dan terpotong di tengah.
    expect(perkiraanUnit(struk({ lines: [{ name: "K", variant: "N", qty: 1, price: 1 }] }))).toBe(2);
  });

  it("ikut memanjangnya nama menu dan catatan", () => {
    const pendek = perkiraanUnit(struk({ lines: [{ name: "K", variant: "N", qty: 1, price: 1 }] }));
    const panjang = perkiraanUnit(
      struk({
        lines: [
          {
            name: "Kakap Asam Manis Special With Extra Sauce Admiral Dan Sambal",
            variant: "N",
            qty: 1,
            price: 1,
            note: "kurang pedas, sambal terpisah",
          },
        ],
      }),
    );
    expect(panjang).toBeGreaterThan(pendek);
  });

  it("nama customer yang panjang menambah tinggi struk", () => {
    const pendek = perkiraanUnit(struk({ customer: "Budi" }));
    const panjang = perkiraanUnit(struk({ customer: "Reni Gang 4 Baru, Bhaskara 4 No 10, RT 05 RW 11, Sutorejo Utara, Surabaya" }));
    expect(panjang).toBeGreaterThan(pendek);
  });
});

describe("bagiHalamanDetail", () => {
  const banyak = Array.from({ length: 47 }, (_, i) => struk({ receiptNo: `S${i}` }));

  it("tidak ada struk = satu halaman kosong", () => {
    expect(bagiHalamanDetail([], () => 2)).toEqual([{ struk: [], mulai: 0 }]);
  });

  it("semua struk masuk, tidak ada yang hilang", () => {
    const h = bagiHalamanDetail(banyak, () => 2);
    expect(h.reduce((a, x) => a + x.struk.length, 0)).toBe(47);
  });

  it("nomor urut halaman perbaikan, tidak ada duplikat atau lompat", () => {
    const h = bagiHalamanDetail(banyak, () => 2);
    let berikut = 0;
    for (const hal of h) {
      expect(hal.mulai).toBe(berikut);
      berikut += hal.struk.length;
    }
    expect(berikut).toBe(47);
  });

  it("halaman pertama dibatasi lebih ketat", () => {
    const h1 = bagiHalamanDetail(banyak, () => 2);
    const sama46 = bagiHalamanDetail(banyak, () => 2, { batasSatuanHalaman1: 46 });
    expect(h1[0].struk.length).toBeLessThanOrEqual(sama46[0].struk.length);
  });

  it("cadangan untuk halaman terakhir mengurangi isi halaman terakhir", () => {
    // 89 struk isi 2 unit = 178 unit: 40 + 46 + 46 + 46. Halaman terakhir
    // penuh, jadi di sinilah cadangan untuk tabel ongkir bekerja.
    const penuh = Array.from({ length: 89 }, (_, i) => struk({ receiptNo: `P${i}` }));
    const tanpa = bagiHalamanDetail(penuh, () => 2);
    const dengan = bagiHalamanDetail(penuh, () => 2, { cadanganHalamanAkhir: 14 });
    /* Yang dibandingkan bukan jumlah struknya (bisa kebetulan sama),
       tapi ruang yang tersisa di halaman terakhir: cadangan pasti membuat
       halaman terakhir lebih longgar. */
    const sisa = (h: { struk: unknown[] }[]) => 46 - h[h.length - 1].struk.length * 2;
    expect(sisa(dengan)).toBeGreaterThan(sisa(tanpa));
    // tidak boleh tersisa satu struk: halaman kosong terlihat aneh
    expect(dengan[dengan.length - 1].struk.length).toBeGreaterThan(1);
  });

  it("struk yang lebih besar dari batas halaman tidak pernah melebihi batas", () => {
    const satu = struk({ customer: "x".repeat(4000), lines: Array.from({ length: 40 }, () => ({ name: "y".repeat(200), variant: "N", qty: 1, price: 1 })) });
    const h = bagiHalamanDetail([satu], () => perkiraanUnit(satu), { batasSatuanHalaman1: 10 });
    expect(h).toHaveLength(1);
    expect(h[0].struk).toHaveLength(1);
  });
});

describe("barisTransaksi — penanda lunas di kolom nama", () => {
  it("struk lunas mendapat 'Lunas' tebal setelah nama", () => {
    const baris = barisTransaksi(struk({ status: "lunas", customer: "Budi" }), 0, "-");
    expect(baris).toContain('Budi <span class="print-report-lunas">Lunas</span>');
  });

  it("struk belum lunas hanya menampilkan nama", () => {
    const baris = barisTransaksi(struk({ status: "belum", customer: "Budi" }), 0, "-");
    expect(baris).toContain(">Budi</td>");
    expect(baris).not.toContain("print-report-lunas");
  });

  it("penanda muncul juga untuk struk tanpa item", () => {
    const baris = barisTransaksi(struk({ status: "lunas", lines: [] }), 0, "-");
    expect(baris).toContain('class="print-report-lunas"');
  });
});

describe("labelTanggal", () => {
  it("memakai nama hari dan bulan lengkap, seperti formatDateLabel lama", () => {
    expect(labelTanggal("2026-09-30")).toBe("Rabu, 30 September 2026");
  });

  it("tanggal rusak tidak membuat Exception", () => {
    expect(labelTanggal("bukan tanggal")).toBe("bukan tanggal");
  });
});

describe("labelRentang", () => {
  it("satu hari = satu tanggal saja", () => {
    const l = labelRentang("2026-09-01", "2026-09-01");
    expect(l).toBe("Selasa, 1 September 2026");
    expect(l).not.toContain("Hari ini");
  });

  it("rentang pakai tanda hubung", () => {
    expect(labelRentang("2026-09-01", "2026-09-05")).toBe(
      "Selasa, 1 September 2026 - Sabtu, 5 September 2026",
    );
  });
});
