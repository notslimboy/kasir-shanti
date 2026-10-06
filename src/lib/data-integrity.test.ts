import { describe, expect, it } from "vitest";

import { subtotalStruk, type Sale } from "./sale";
import { menuTerlarisDari, pelangganFavoritDari, ringkasOngkir, ringkasanDari, mundur, trenPerHari, trenPerJam } from "./ringkasan";
import { halfVariantPrice } from "./pricing";
import { ongkirDari } from "./live-mappers";
import type { SaleRow } from "@/supabase/types";

/* Tidak ada lagi data contoh di repo ini, jadi test ini membangun datanya
   sendiri lalu memeriksa aturan yang benar-benar berlaku di aplikasi.
   Tujuannya: aturan bisnis tidak bisa dilanggar diam-diam. */

/* -------------------------------------------------------------------------
   Bentuk data
   ---------------------------------------------------------------------- */

const struk = (p: Partial<Sale> = {}): Sale => ({
  receiptNo: "SH-1",
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
  // id ditulis setelah spread supaya Partial<Sale> dengan id tidak ada
  // tidak membuat tipe sostuk jadi(number | undefined).
  id: p.id ?? 1,
});

const sale = (p: Partial<SaleRow> = {}): SaleRow => ({
  id: 1,
  receipt_no: "SH-1",
  completed_at: "2026-09-30T07:00:00.000+00:00",
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
  paid_amount: 100_000,
  created_at: "2026-09-30T07:00:00.000+00:00",
  queue_no: 1,
  queue_date: "2026-09-30",
  send_note: "",
  ...p,
});

/* -------------------------------------------------------------------------
   Invariant struk: total harus sama dengan rinciannya
   ---------------------------------------------------------------------- */

describe("invariants struk", () => {
  /* Ini rumus yang ditemukan dari 2.129 struk nyata, bukan tebakan:
     ongkir = total − subtotal + diskon − tax, dan hasilnya tidak pernah
     negatif. Test mengunci rumus itu lewat struk yang konsisten. */
  it("total = subtotal − diskon + ongkir", () => {
    const lines = [
      { name: "Nasi Goreng", variant: "Normal", qty: 2, price: 20_000 },
      { name: "Es Kopi", variant: "Separuh", qty: 1, price: 9_000 },
    ];
    const subtotal = 2 * 20_000 + 9_000; // 49.000
    const diskon = 5_000;
    const ongkir = 15_000;
    const s = struk({ lines, diskon, ongkir, total: subtotal - diskon + ongkir });
    expect(s.total).toBe(subtotalStruk(s) - (s.diskon ?? 0) + (s.ongkir ?? 0));
    expect(s.total).toBe(59_000);
  });

  it("ongkir diturunkan dari kolom sales, bukan disimpan", () => {
    const row = sale({ subtotal: 100_000, discount: 10_000, tax: 0, total: 155_000 });
    // 155.000 − 100.000 = 55.000. Kolom discount (10.000) tidak ditambah:
    // di 1.000 struk nyata kolom itu selalu sama dengan total − subtotal,
    // jadi menambahkannya akan=ongkir terhitung dua kali.
    expect(ongkirDari(row)).toBe(55_000);
    expect(ongkirDari(sale({ subtotal: 100_000, discount: 0, tax: 0, total: 100_000 }))).toBe(0);
  });

  it("struk tanpa item tidak error", () => {
    expect(subtotalStruk(struk({ lines: [] }))).toBe(0);
  });
});

/* -------------------------------------------------------------------------
   Aturan harga separuh
   ---------------------------------------------------------------------- */

describe("harga separuh", () => {
  it("setengah harga, minimal Rp 10.000", () => {
    expect(halfVariantPrice(30_000)).toBe(15_000);
    expect(halfVariantPrice(18_000)).toBe(10_000); // 9.000 → dinaikkan
    expect(halfVariantPrice(1_000)).toBe(10_000);
  });
});

/* -------------------------------------------------------------------------
   Agregasi
   ---------------------------------------------------------------------- */

describe("menu terlaris", () => {
  it("menjumlahkan item dari semua struk, diurut qty terbesar", () => {
    const t = menuTerlarisDari([
      struk({ lines: [{ name: "Nasi", variant: "Normal", qty: 2, price: 20_000 }] }),
      struk({ lines: [{ name: "Nasi", variant: "Normal", qty: 3, price: 20_000 }] }),
      struk({ lines: [{ name: "Ayam", variant: "Normal", qty: 9, price: 30_000 }] }),
    ]);
    expect(t[0]).toEqual({ rank: 1, name: "Ayam", qty: 9, omset: 270_000 });
    expect(t[1]).toEqual({ rank: 2, name: "Nasi", qty: 5, omset: 100_000 });
  });

  it("struk terhapus tidak ikut dihitung", () => {
    const t = menuTerlarisDari([
      struk({ status: "terhapus", lines: [{ name: "Palsu", variant: "Normal", qty: 99, price: 1_000 }] }),
    ]);
    expect(t).toEqual([]);
  });

  it("dibatasi jumlah baris", () => {
    const banyak = Array.from({ length: 20 }, (_, i) =>
      struk({ lines: [{ name: `M${i}`, variant: "Normal", qty: 1, price: 1_000 }] }),
    );
    expect(menuTerlarisDari(banyak, 6)).toHaveLength(6);
  });
});

describe("ringkas ongkir", () => {
  it("hanya menghitung struk yang berongkir", () => {
    const r = ringkasOngkir([
      struk({ ongkir: 15_000 }),
      struk({ ongkir: 0 }),
      struk({ ongkir: 25_000 }),
      struk({ ongkir: 99_000, status: "terhapus" }),
    ]);
    expect(r.strukBerongkir).toBe(2);
    expect(r.total).toBe(40_000);
    expect(r.rataRata).toBe(20_000);
  });

  it("tidak ada ongkir = nol, bukan NaN", () => {
    expect(ringkasOngkir([])).toEqual({ total: 0, strukBerongkir: 0, rataRata: 0 });
  });
});

describe("ringkasan beranda", () => {
  const HARI = "2026-09-30";

  it("menghitung per periode", () => {
    const r = ringkasanDari(
      [
        sale({ id: 1, total: 100_000, completed_at: "2026-09-30T02:00:00Z" }),
        sale({ id: 2, total: 50_000, completed_at: "2026-09-29T02:00:00Z" }),
        sale({ id: 3, total: 25_000, completed_at: "2026-09-01T02:00:00Z" }),
      ],
      HARI,
    );
    expect(r.hariIni.omset).toBe(100_000);
    expect(r.bulanIni.transaksi).toBe(3);
    expect(r.mingguIni.transaksi).toBe(2);
  });

  it("struk dihapus diabaikan", () => {
    const r = ringkasanDari([sale({ total: 999_000, deleted_at: "2026-09-30T09:00:00Z" })], HARI);
    expect(r.hariIni.omset).toBe(0);
  });

  it("piutang = belum lunas", () => {
    const r = ringkasanDari(
      [sale({ id: 1, total: 100_000, paid_amount: 0 }), sale({ id: 2, total: 100_000, paid_amount: 100_000 })],
      HARI,
    );
    expect(r.piutang).toEqual({ nominal: 100_000, count: 1 });
  });

  it("tren selalu 30 hari, termasuk hari kosong", () => {
    expect(ringkasanDari([], HARI).tren).toHaveLength(30);
  });

  it("tidak ada data = nol semua", () => {
    const r = ringkasanDari([], HARI);
    expect(r.hariIni).toEqual({ omset: 0, transaksi: 0, item: 0 });
    expect(r.metodePembayaran).toEqual([]);
    expect(r.piutang).toEqual({ nominal: 0, count: 0 });
  });
});

describe("pelanggan favorit", () => {
  it("urut dari belanja terbesar, hanya yang pernah order", () => {
    const f = pelangganFavoritDari([
      { name: "A", orderCount: 0, total: 0, lastOrder: "—" },
      { name: "B", orderCount: 2, total: 100_000, lastOrder: "1 Sep 2026" },
      { name: "C", orderCount: 1, total: 900_000, lastOrder: "2 Sep 2026" },
    ]);
    expect(f.map((x) => x.name)).toEqual(["C", "B"]);
  });
});

describe("mundur", () => {
  it("aman lintas bulan dan tahun", () => {
    expect(mundur("2026-09-30", 1)).toBe("2026-09-29");
    expect(mundur("2026-09-01", 1)).toBe("2026-08-31");
    expect(mundur("2026-01-01", 1)).toBe("2025-12-31");
  });
});

/* -------------------------------------------------------------------------
   Tren per jam — hanya untuk rentang satu hari
   ---------------------------------------------------------------------- */

describe("tren per jam", () => {
  /* Jam lokal kasir = jam UTC + 7. Jadi 02:30Z = 09:30 WIB, dan 18:30Z
     = 01:30 WIB keesokan harinya. */
  const jam = (utc: string, total: number, status: "lunas" | "belum" | "terhapus" = "lunas") => ({
    ...struk({ total, status }),
    completedIso: `2026-09-30T${utc}:00.000+00:00`,
  });

  it("selalu 24 slot, termasuk jam tanpa transaksi", () => {
    expect(trenPerJam([])).toHaveLength(24);
    expect(trenPerJam([]).every((s) => s.omset === 0 && s.transaksi === 0)).toBe(true);
  });

  it("mengelompokkan menurut jam lokal kasir, bukan jam server", () => {
    const t = trenPerJam([jam("02:30", 100_000), jam("18:30", 50_000), jam("02:45", 25_000)]);
    // 02:30Z → 09:30 WIB, 18:30Z → 01:30 WIB (+1 hari)
    expect(t[1]).toEqual({ label: "01:00", tanggal: "2026-09-30", omset: 50_000, transaksi: 1 });
    expect(t[9]).toEqual({ label: "09:00", tanggal: "2026-09-30", omset: 125_000, transaksi: 2 });
  });

  it("struk terhapus diabaikan", () => {
    expect(trenPerJam([jam("02:30", 999_000, "terhapus")])[9].transaksi).toBe(0);
  });

  it("jam tanpa transaksi tidak dikarang tanggalnya", () => {
    // Kalau tanggalnya dikarang, tooltip jam kosong akan menampilkan tanggal
    // yang tidak pernah ada transaksinya.
    expect(trenPerJam([jam("02:30", 10_000)])[0].tanggal).toBe("");
  });

  it("ISO rusak diabaikan, bukan bikin NaN di grafik", () => {
    const rusak = { ...struk(), completedIso: "bukan tanggal" };
    expect(trenPerJam([rusak])[12].transaksi).toBe(0);
  });
});

describe("tren per hari", () => {
  it("mengelompokkan per tanggal lokal, terurut", () => {
    const t = trenPerHari([
      { ...struk({ total: 20_000, completedOn: "2026-09-02" }) },
      { ...struk({ total: 10_000, completedOn: "2026-09-01" }) },
      { ...struk({ total: 5_000, completedOn: "2026-09-01" }) },
    ]);
    expect(t).toEqual([
      { label: "1", tanggal: "2026-09-01", omset: 15_000, transaksi: 2 },
      { label: "2", tanggal: "2026-09-02", omset: 20_000, transaksi: 1 },
    ]);
  });

  it("struk terhapus diabaikan", () => {
    expect(trenPerHari([struk({ status: "terhapus" })])).toEqual([]);
  });

  it("rentang lintas bulan: label memakai bulan, kalau tidak angka hari jadi ambigu", () => {
    const t = trenPerHari([
      { ...struk({ total: 10_000, completedOn: "2026-08-05" }) },
      { ...struk({ total: 20_000, completedOn: "2026-09-05" }) },
    ]);
    expect(t.map((x) => x.label)).toEqual(["5 Agu", "5 Sep"]);
    expect(t.map((x) => x.tanggal)).toEqual(["2026-08-05", "2026-09-05"]);
  });

  it("satu bulan saja: label cukup angka tanggal", () => {
    expect(trenPerHari([{ ...struk({ completedOn: "2026-09-05" }) }])[0].label).toBe("5");
  });
});

/* -------------------------------------------------------------------------
   Perbandingan periode — kartu KPI menampilkan naik/turunnya
   ---------------------------------------------------------------------- */

describe("banding periode", () => {
  const HARI = "2026-09-30";
  const s = (tanggal: string, total: number) => sale({ total, completed_at: `${tanggal}T08:00:00.000+00:00` });

  it("hari ini dibandingkan dengan kemarin", () => {
    const r = ringkasanDari([s("2026-09-30", 100_000), s("2026-09-29", 50_000)], HARI);
    expect(r.bandingHariIni).toEqual({ persen: 100, sebelumnya: 50_000 });
  });

  it("turun kalau omsetnya mengecil, dan tandanya negatif", () => {
    const r = ringkasanDari([s("2026-09-30", 40_000), s("2026-09-29", 100_000)], HARI);
    expect(r.bandingHariIni?.persen).toBe(-60);
  });

  it("periode lalu nihil = tidak ada pembanding, bukan 0% atau +100%", () => {
    const r = ringkasanDari([s("2026-09-30", 100_000)], HARI);
    expect(r.bandingHariIni).toBeUndefined();
  });

  it("bulan ini dibandingkan dengan awal bulan lalu sampai tanggal yang sama", () => {
    // 30 September: bulan lalu dibandingkan 1–30 Agustus, bukan 1–31.
    const r = ringkasanDari(
      [
        s("2026-09-30", 90_000),
        s("2026-08-01", 30_000),
        s("2026-08-30", 30_000),
        // Tanggal yang TIDAK boleh ikut: 31 Agustus.
        s("2026-08-31", 900_000),
      ],
      HARI,
    );
    expect(r.bandingBulanIni?.sebelumnya).toBe(60_000);
    expect(r.bandingBulanIni?.persen).toBe(50);
  });

  it("minggu ini dibandingkan dengan 7 hari sebelumnya, bukan 7 hari terakhir", () => {
    const r = ringkasanDari(
      [
        s("2026-09-30", 80_000), // hari ini
        s("2026-09-26", 20_000), // dalam minggu ini
        s("2026-09-23", 40_000), // batas: 7 hari sebelum jendela minggu ini
        s("2026-09-16", 999_000), // di luar rentang pembanding
      ],
      HARI,
    );
    // minggu ini = 100.000 (80.000 + 20.000), pembanding 40.000 → +150%
    expect(r.bandingMingguIni?.sebelumnya).toBe(40_000);
    expect(r.bandingMingguIni?.persen).toBe(150);
  });

  it("tidak ada data = tidak ada pembanding", () => {
    const r = ringkasanDari([], HARI);
    expect(r.bandingHariIni).toBeUndefined();
    expect(r.bandingBulanIni).toBeUndefined();
    expect(r.bandingMingguIni).toBeUndefined();
  });
});
