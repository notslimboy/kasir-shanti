import { useMemo } from "react";

import type { SaleRow } from "@/supabase/types";
import { ongkirDari, statusDari, tanggalISODari } from "./live-mappers";

/* ==========================================================================
   Agregasi untuk kartu KPI di Beranda.

   Semuanya diturunkan dari sales, bukan disimpan. Ditulis sebagai fungsi
   murni supaya bisa diuji dengan data contoh, dan supaya angka di empat
   kartu berasal dari satu perhitungan yang sama.
   ========================================================================== */

export type RingkasanHarian = {
  omset: number;
  transaksi: number;
  item: number;
};

const BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Perubahan persen terhadap periode sebelumnya.
 *
 *  undefined = tidak ada pembanding. Ini berbeda dari 0: kalau periode lalu
 *  nihil, "0%" atau "+100%" adalah angka karangan, dan kartu akan menampilkan
 *  pertumbuhan yang sebenarnya tidak bisa diukur. */
export type Perbandingan = { persen: number; sebelumnya: number } | undefined;

export type Ringkasan = {
  hariIni: RingkasanHarian;
  bulanIni: RingkasanHarian;
  mingguIni: RingkasanHarian;
  /** Perubahan omset terhadap periode sebelumnya, dalam persen. */
  bandingHariIni: Perbandingan;
  bandingBulanIni: Perbandingan;
  bandingMingguIni: Perbandingan;
  piutang: { nominal: number; count: number };
  /** Omset 7 hari terakhir per hari, untuk kartu tren. */
  tren: { d: string; tanggal: string; omset: number; transaksi: number }[];
  metodePembayaran: { name: string; total: number; pct: number }[];
  terlaris: { rank: number; name: string; qty: number; omset: number }[];
};

/** Struk yang dipakai: yang tidak dihapus. */
const hidup = (s: SaleRow) => !s.deleted_at;

export function ringkasanDari(
  sales: SaleRow[],
  /** Tanggal "hari ini" menurut zona waktu kasir (YYYY-MM-DD). */
  hariIniISO: string,
  /** Berapa hari ke belakang yang dipakai kartu tren. */
  hariTren = 30,
): Ringkasan {
  const aktif = sales.filter(hidup);

  /* Tanggal bisnis mengikuti jam kasir (WIB), bukan jam server. Tanpa ini
     struk yang masuk 01.00 WIB — 18.00 UTC sehari sebelumnya — akan dihitung
     ke tanggal yang salah, dan kartu "hari ini" kehilangan ~7 jam terakhir. */
  /* Di-cache per objek baris, bukan per id: kalau dua baris kebetulan
     berbagi id, Map<number> akan mengembalikan tanggal
     baris pertama untuk keduanya dan memindahkan omset ke hari yang salah. */
  const tanggalLokal = new WeakMap<SaleRow, string>();
  const tanggal = (s: SaleRow): string => {
    let v = tanggalLokal.get(s);
    if (!v) {
      v = tanggalISODari(s);
      tanggalLokal.set(s, v);
    }
    return v;
  };

  const dalamRentang = (dari: string, sampai: string) =>
    aktif.filter((s) => {
      const t = tanggal(s);
      return t >= dari && t <= sampai;
    });

  const hitung = (rows: SaleRow[]): RingkasanHarian => ({
    omset: rows.reduce((a, s) => a + Number(s.total || 0), 0),
    transaksi: rows.length,
    // Jumlah item butuh sale_items; ini mengisi placeholder supaya bentuk
    // Ringkasan konsisten. Halaman tidak menampilkan angka ini di Beranda.
    item: 0,
  });

  const hariIni = dalamRentang(hariIniISO, hariIniISO);
  const bulanIni = dalamRentang(hariIniISO.slice(0, 8) + "01", hariIniISO);
  const weekMulai = mundur(hariIniISO, 6);

  /* --- tren harian --- */
  const petaHarian = new Map<string, { omset: number; transaksi: number }>();
  for (let i = hariTren - 1; i >= 0; i--) {
    petaHarian.set(mundur(hariIniISO, i), { omset: 0, transaksi: 0 });
  }
  for (const s of aktif) {
    const k = tanggal(s);
    const slot = petaHarian.get(k);
    if (!slot) continue;
    slot.omset += Number(s.total || 0);
    slot.transaksi += 1;
  }
  /* Label tren harus bisa dibaca sendiri. Dulu hanya tanggal dalam bulan
     ("5"), jadi di rentang 90 hari — yang melintasi Agustus dan September —
     "5" muncul dua kali dan tooltip-nya tidak bisa bilang tanggal yang mana
     yang dimaksud. Sekarang bulan ikut ditulis begitu rentangnya melewati
     satu bulan, dan tanggal lengkapnya dibawa untuk tooltip. */
  const semuaTanggal = [...petaHarian.keys()].sort();
  const bulanBerbeda = new Set(semuaTanggal.map((d) => d.slice(0, 7))).size > 1;
  const tren = semuaTanggal.map((d) => ({
    d: bulanBerbeda ? `${Number(d.slice(8))} ${BULAN_SINGKAT[Number(d.slice(5, 7)) - 1]}` : String(Number(d.slice(8))),
    tanggal: d,
    ...petaHarian.get(d)!,
  }));

  /* --- metode pembayaran --- */
  const petaBayar = new Map<string, number>();
  for (const s of aktif) {
    const k = String(s.payment || "Lainnya");
    petaBayar.set(k, (petaBayar.get(k) ?? 0) + Number(s.total || 0));
  }
  const totalBayar = [...petaBayar.values()].reduce((a, b) => a + b, 0);
  const metodePembayaran = [...petaBayar.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, total]) => ({
      name,
      total,
      pct: totalBayar > 0 ? Math.round((total / totalBayar) * 100) : 0,
    }));

  /* --- piutang --- */
  const belum = aktif.filter((s) => statusDari(s) === "belum");
  const piutang = {
    nominal: belum.reduce((a, s) => a + (Number(s.total || 0) - Number(s.paid_amount || 0)), 0),
    count: belum.length,
  };

  /* Periode pembanding — rentang dengan panjang yang sama, tepat sebelum
     periode yang ditampilkan. "Bulan ini" dibandingkan dengan awal bulan
     lalu sampai tanggal yang sama, supaya 30 hari banding 30 hari, bukan 30
     hari banding dengan bulan lalu yang mungkin hanya 28. */
  /* Jendela pembanding:
       hari ini  → kemarin
       minggu ini→ 7 hari penuh tepat sebelum jendela minggu ini
       bulan ini → awal bulan lalu sampai tanggal yang sama di bulan itu,
                   dibatasi jumlah hari bulan lalu (31 Agustus tidak boleh
                   ikut kalau dibandingkan 30 September) */
  const tgl = new Date(`${hariIniISO}T00:00:00`);
  const awalBulanLalu = new Date(tgl.getFullYear(), tgl.getMonth() - 1, 1);
  const akhirBulanLalu = new Date(awalBulanLalu.getFullYear(), awalBulanLalu.getMonth() + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const bulanLaluDari = iso(awalBulanLalu);
  const bulanLaluSampai = iso(
    new Date(awalBulanLalu.getFullYear(), awalBulanLalu.getMonth(), Math.min(tgl.getDate(), akhirBulanLalu.getDate())),
  );
  const banding = (kini: RingkasanHarian, dari: string, sampai: string): Perbandingan => {
    const omsetSebelumnya = dalamRentang(dari, sampai).reduce((a, s) => a + Number(s.total || 0), 0);
    if (omsetSebelumnya <= 0) return undefined;
    return { persen: ((kini.omset - omsetSebelumnya) / omsetSebelumnya) * 100, sebelumnya: omsetSebelumnya };
  };
  const omsetHariIni = hitung(hariIni);
  const omsetBulanIni = hitung(bulanIni);
  const omsetMingguIni = hitung(dalamRentang(weekMulai, hariIniISO));
  return {
    hariIni: omsetHariIni,
    bulanIni: omsetBulanIni,
    mingguIni: omsetMingguIni,
    bandingHariIni: banding(omsetHariIni, mundur(hariIniISO, 1), mundur(hariIniISO, 1)),
    bandingBulanIni: banding(omsetBulanIni, bulanLaluDari, bulanLaluSampai),
    bandingMingguIni: banding(omsetMingguIni, mundur(weekMulai, 7), mundur(weekMulai, 1)),
    piutang,
    tren,
    metodePembayaran,
    terlaris: [],
  };
}

/** Tanggal YYYY-MM-DD mundur n hari, aman terhadap pergantian bulan/tahun. */
export function mundur(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d - n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Ongkiran dari seluruh struk pada rentang — dipakai kartu kurir. */
export function totalOngkir(sales: SaleRow[]): number {
  return sales.filter(hidup).reduce((a, s) => a + ongkirDari(s), 0);
}

/** Helper kecil supaya beranda bisa membandingkan periode tanpa import date. */
export function persenPerubahan(kini: number, lalu: number): number {
  if (lalu === 0) return kini > 0 ? 100 : 0;
  return Number((((kini - lalu) / lalu) * 100).toFixed(1));
}

export function useRingkasan(sales: SaleRow[], hariIniISO: string): Ringkasan {
  return useMemo(() => ringkasanDari(sales, hariIniISO), [sales, hariIniISO]);
}

/* -------------------------------------------------------------------------
   Agregasi dari sale_items.

   Menu Terlaris tidak bisa diambil dari tabel mana pun — harus dijumlahkan
   dari baris item. Sumbernya baris struk pada rentang aktif, jadi angkanya
   selalu sama dengan tabel detail di bawahnya.
   ---------------------------------------------------------------------- */

import type { Sale } from "./sale";

export type Terlaris = { rank: number; name: string; qty: number; omset: number };

export function menuTerlarisDari(struk: Sale[], batas = 6): Terlaris[] {
  const peta = new Map<string, { name: string; qty: number; omset: number }>();
  for (const s of struk) {
    if (s.status === "terhapus") continue;
    for (const l of s.lines ?? []) {
      const cur = peta.get(l.name) ?? { name: l.name, qty: 0, omset: 0 };
      cur.qty += l.qty;
      cur.omset += l.price * l.qty;
      peta.set(l.name, cur);
    }
  }
  return [...peta.values()]
    .sort((a, b) => b.qty - a.qty || b.omset - a.omset || a.name.localeCompare(b.name, "id-ID"))
    .slice(0, batas)
    .map((m, i) => ({ rank: i + 1, ...m }));
}

/* -------------------------------------------------------------------------
   Ongkir

   TIDAK ADA kolom kurir di tabel sales. Data itu memang tidak tersimpan,
   jadi kartu tidak boleh mengarang nama kurir. Yang bisa ditampilkan hanya
   angkanya, disertai keterangan bahwa kurir belum dicatat.
   ---------------------------------------------------------------------- */

export type RingkasOngkir = {
  total: number;
  strukBerongkir: number;
  rataRata: number;
};

export function ringkasOngkir(struk: Sale[]): RingkasOngkir {
  const yang = struk.filter((s) => s.status !== "terhapus" && (s.ongkir ?? 0) > 0);
  const total = yang.reduce((a, s) => a + (s.ongkir ?? 0), 0);
  return {
    total,
    strukBerongkir: yang.length,
    rataRata: yang.length ? Math.round(total / yang.length) : 0,
  };
}

/* -------------------------------------------------------------------------
   Pelanggan favorit — dari customers + rekap sales, bukan daftar konstan.
   ---------------------------------------------------------------------- */

export type Favorit = { name: string; orderCount: number; total: number; lastOrder: string };

export function pelangganFavoritDari(
  customers: { name: string; orderCount: number; total: number; lastOrder: string }[],
  batas = 5,
): Favorit[] {
  return [...customers]
    .filter((c) => c.orderCount > 0)
    .sort((a, b) => b.total - a.total || b.orderCount - a.orderCount)
    .slice(0, batas)
    .map((c) => ({ name: c.name, orderCount: c.orderCount, total: c.total, lastOrder: c.lastOrder }));
}

/* -------------------------------------------------------------------------
   Omset per jam.

   Hanya berguna untuk rentang satu hari: "jam berapa toko ramai" tidak bisa
   dijawab dari data beberapa minggu. Slot 00–23 selalu dibuat, termasuk yang
   kosong — kalau hanya jam yang ada struk, grafik akan terlihat seperti
   toko buka nonstop.
   ---------------------------------------------------------------------- */

/* Bentuk yang sama dipakai tren per jam dan per hari, jadi komponen chart
   tidak perlu tahu mana yang sedang aktif. */
export type TitikTren = { label: string; tanggal: string; omset: number; transaksi: number };

export function trenPerJam(struk: Sale[]): TitikTren[] {
  const slot = new Map<number, { omset: number; transaksi: number; tanggal: string }>();
  for (let j = 0; j < 24; j++) slot.set(j, { omset: 0, transaksi: 0, tanggal: "" });
  for (const s of struk) {
    if (s.status === "terhapus") continue;
    const w = new Date(s.completedIso);
    if (Number.isNaN(w.getTime())) continue;
    const cur = slot.get(w.getHours());
    if (!cur) continue;
    cur.omset += s.total;
    cur.transaksi += 1;
    // Jam tanpa transaksi tidak punya tanggal; biarkan kosong supaya
    // tooltip-nya jatuh ke label jam, bukan ke tanggal yang dikarang.
    if (!cur.tanggal) cur.tanggal = s.completedOn;
  }
  return [...slot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([jam, v]) => ({ label: `${String(jam).padStart(2, "0")}:00`, ...v }));
}

/** Omset per hari, mengikuti tanggal lokal kasir.
 *
 *  Labelnya sama aturan tren beranda: angka tanggal saja kalau rentangnya
 *  tidak melewati bulan, "5 Sep" kalau)iya. Tanpa bulan, tooltip "5" di
 *  grafik sebulan tidak bisa told user tanggal yang mana. */
export function trenPerHari(struk: Sale[]): TitikTren[] {
  const peta = new Map<string, { omset: number; transaksi: number }>();
  for (const s of struk) {
    if (s.status === "terhapus") continue;
    const cur = peta.get(s.completedOn) ?? { omset: 0, transaksi: 0 };
    cur.omset += s.total;
    cur.transaksi += 1;
    peta.set(s.completedOn, cur);
  }
  const urut = [...peta.keys()].sort();
  const bulanBerbeda = new Set(urut.map((d) => d.slice(0, 7))).size > 1;
  return urut.map((tgl) => ({
    label: bulanBerbeda
      ? `${Number(tgl.slice(8))} ${BULAN_SINGKAT[Number(tgl.slice(5, 7)) - 1]}`
      : String(Number(tgl.slice(8))),
    tanggal: tgl,
    ...peta.get(tgl)!,
  }));
}
