import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ambilInti,
  ambilProduk,
  ambilSales,
  ambilStruk,
  customerUntukUI,
  gabungProdukKembar,
  produkUntukUI,
  strukUntukUI,
  type AliasCustomer,
  type DataInti,
  type DataProduk,
} from "@/lib/live";
import { cacheBaca, cacheHapus, cacheHapusAwalan, cacheTulis } from "@/lib/cache-db";
import type { Sale } from "@/lib/sale";
import type { Customer } from "@/lib/page-data";
import type { Product as MenuProduct } from "@/lib/menu-seed";
import { varianUntukProduk, type VarianProduk } from "@/lib/live-mappers";
import type { CustomerRow, ProductRow, ProductVariantRow, SaleItemRow, SaleRow } from "@/supabase/types";
import { isProdukStale, padaProdukStale, resetProdukStale } from "@/lib/data-source-signal";

/* ==========================================================================
   Sumber data untuk seluruh halaman.

   Kalau Supabase bisa dibaca, pakai data itu. Kalau tidak, halaman
   menampilkan keadaan KOSONG yang jujur — bukan angka contoh.

   Beban dimuat dalam dua tahap, karena products + varian berdurasi 4,4
   detik sementara Beranda tidak memakainya sama sekali:

     tahap 1 (sekali saat dibuka) : customers + sales untuk agregasi
     tahap 2 (on-demand)         : 1.095 produk + 3.285 varian,
                                   hanya saat /kasir atau /menu dibuka

   Hasil tahap 2 disimpan di sessionStorage, jadi pindah halaman bolak-balik
   tidak menariknya lagi.
   ========================================================================== */

export type StatusData = "memuat" | "live" | "gagal";

type Toko = {
  status: StatusData;
  error: string | null;
  /** Struk dari Supabase, sudah di-mapping. Kosong saat gagal. */
  struk: Sale[];
  customers: Customer[];
  /** Nama lain yang dipakai kasir untuk customer yang sama ("Bhas Sari 38"
      → "Bhaskara sari 38"). Dipakai untuk mencari di dropdown keranjang;
      yang TERSIMPAN ke struk tetap nama asli dari `customers`. */
  customerAlias: AliasCustomer[];
  /** True setelah produk & varian benar-benar terambil. */
  produkSiap: boolean;
  /** True kalau katalog SUDAH ditarik — sudah ditarik dengan 0 hasil atau belum?
      Dua itu maknanya berbeda: "belum dimuat" berarti coba lagi,
      "kosong" berarti memang tidak ada menu. Menyingkatkannya membuat
      halaman terus menawarkan memuat ulang padahal tidak ada yang bisa ditarik. */
  produkDimuat: boolean;
  /** True saat katalog sedang ditarik — halaman perlu menampilkan
      "memuat menu", bukan "tidak ada menu". */
  produkMemuat: boolean;
  /** Kosong selama produk belum dimuat — itu bukan berarti tidak ada menu. */
  products: ProductRow[];
  varian: Map<string, VarianProduk[]>;
  produk: MenuProduct[];
  /** Struk mentah untuk agregasi (status & ongkir tidak perlu mapping ulang).
      Hanya berisi rentang yang sedang aktif — bukan seluruh riwayat. */
  salesMentah: SaleRow[];
  /** 30 hari terakhir, lengkap dengan sale_items, untuk kartu Beranda
      (Menu Terlaris & Struk Terbaru). Dipisah dari salesMentah supaya tab
      tanggal di Penjualan tidak ikut mengubah isi Beranda — dan sebaliknya. */
  ringkasStruk: Sale[];
  /** Seluruh riwayat (kolom ramping, tanpa sale_items) untuk KPI Beranda.
      Dipisah dari salesMentah supaya ringkasan bulanan tidak ikut terpotong
      oleh tab tanggal yang sedang dibuka di halaman lain. */
  salesSemua: SaleRow[];
  diambilPada: Date | null;
  /** Dipanggil /kasir dan /menu untuk memuat katalog. Aman dipanggil berkali-kali. */
  pastikanProduk: () => void;
  muatRentang: (dari?: string, sampai?: string) => Promise<void>;
  /** Tarik ulang paksa + buang cache. Dipakai setelah hapus/restore struk,
   *  karena muatRentang biasa akan skip kalau rentangnya sama. */
  segarkanRentang: (dari?: string, sampai?: string) => Promise<void>;
  /** Setelah menulis ke database dari halaman lain (impor pesanan):
   *  semua cache rentang dibuang dan penjaga request di-reset, supaya
   *  halaman berikutnya benar-benar menarik data baru, bukan data lama. */
  invalidasiSetelahTulis: () => Promise<void>;
  /** Invalidasi + tarik ulang data yang berubah, TANPA mengosongkan layar
   *  dan tanpa menarik ulang katalog 1.095 produk. Dipakai setelah impor:
   *  hasil import tidak boleh terlihat "halaman sedang memuat" — daftar
   *  draft yang sedang diperiksa kasir harus tetap utuh. */
  perbaruiSetelahTulis: () => Promise<void>;
  muatUlang: () => Promise<void>;
};

const Ctx = createContext<Toko | null>(null);

/* Map<number, SaleItemRow[]> tidak bisa disimpan apa adanya ke IndexedDB —
   structured clone tidak bisa menyalin Map. Jadi item per struk disimpan
   sebagai array [id, baris[]] lalu dibaca lagi jadi Map. */
function keItemRows(entries: [number, SaleItemRow[]][]): Map<number, SaleItemRow[]> {
  return new Map(entries);
}

const KOSONG = {
  struk: [] as Sale[],
  customers: [] as Customer[],
  /** Nama alternatif customer, untuk pencarian di keranjang. */
  customerAlias: [] as AliasCustomer[],
  products: [] as ProductRow[],
  varian: new Map<string, VarianProduk[]>(),
  produk: [] as MenuProduct[],
  salesMentah: [] as SaleRow[],
  salesSemua: [] as SaleRow[],
  ringkasStruk: [] as Sale[],
};

/* Cache lokal memakai IndexedDB (lihat lib/cache-db.ts). Katalog 1.099 +
   varian 3.297 = 3 MB, tidak muat di localStorage.
 *
   Tidak ada tombol, tidak ada keterangan waktu: cache hanya bekerja di
   belakang layar. Yang tersimpan langsung dipakai untuk mengisi layar,
   lalu data asli menyusul dan menggantikannya. */
const TTL_PRODUK_MENIT = 10;

type CacheProduk = { products: ProductRow[]; varianBaris: ProductVariantRow[] };

function keProduk(c: CacheProduk): DataProduk {
  const varian = new Map<string, VarianProduk[]>();
  for (const p of c.products) varian.set(p.client_id, varianUntukProduk(p, c.varianBaris));
  return { products: c.products, varianBaris: c.varianBaris, varian };
}

export async function bacaCacheProduk(): Promise<DataProduk | null> {
  try {
    const c = await cacheBaca<CacheProduk>("produk");
    if (!c?.data || !Array.isArray(c.data.products)) return null;
    if (!Array.isArray(c.data.varianBaris) || c.data.varianBaris.length === 0) return null;
    return keProduk(c.data);
  } catch {
    return null;
  }
}

export async function tulisCacheProduk(d: DataProduk): Promise<void> {
  await cacheTulis<CacheProduk>("produk", { products: d.products, varianBaris: d.varianBaris });
}

/** True kalau cache masih cukup segar untuk dipakai tanpa ditarik lagi. */
export async function cacheProdukMasihSegar(): Promise<boolean> {
  const c = await cacheBaca<CacheProduk>("produk");
  if (!c?.data || c.data.products.length === 0) return false;
  return Date.now() - c.ts < TTL_PRODUK_MENIT * 60_000;
}

/* Satu promise di tingkat modul, bukan satu per pemanggil: prewarm idle dan
   ensureProduk() bisa berjalan berdekatan tanpa menarik data dua kali. */
let produkBerjalan: Promise<DataProduk> | null = null;

function ambilProdukSekali(): Promise<DataProduk> {
  if (!produkBerjalan) {
    produkBerjalan = ambilProduk().finally(() => {
      produkBerjalan = null;
    });
  }
  return produkBerjalan;
}

export function DataProvider({
  children,
  /** Matikan untuk memaksa tanpa jaringan — dipakai saat menguji tampilan. */
  aktif = true,
}: {
  children: ReactNode;
  aktif?: boolean;
}) {
  const [status, setStatus] = useState<StatusData>("memuat");
  const [error, setError] = useState<string | null>(null);
  const [inti, setInti] = useState<DataInti | null>(null);
  /* Ref cerminan `inti`, dibaca di dalam async: penarik data boleh berjalan
     beberapa detik setelah render terakhir, jadi `inti` yang ada di
     closure sudah basi. */
  const intiRef = useRef<DataInti | null>(null);
  intiRef.current = inti;
  const [produkData, setProdukData] = useState<DataProduk | null>(null);
  const [produkDipinta, setProdukDipinta] = useState(false);
  /* Ref, bukan state: pastikanProduk() bisa dipanggil beberapa kali dalam
     satu render (mis. StrictMode) dan tetap hanya jalan satu query. */
  const produkJalan = useRef(false);
  const [struk, setStruk] = useState<Sale[]>([]);
  const [salesRentang, setSalesRentang] = useState<SaleRow[]>([]);
  const [ringkasStruk, setRingkasStruk] = useState<Sale[]>([]);
  const ringkasJalan = useRef(false);

  /* Kode token token per permintaan: user bisa klik tab Harian lalu
     Bulanan dalam hitungan milidetik, dan respons yang datang belakangan
     bukan selalu yang diminta terakhir. Tanpa token, layar bisa menampilkan
     tab "Bulanan" berisi data mingguan. */
  const rentangToken = useRef(0);
  const rentangTerakhir = useRef<string | null>(null);

  const muatRentang = useCallback(async (dari?: string, sampai?: string) => {
    const kunci = `${dari ?? ""}|${sampai ?? ""}`;
    /* Render ulang (StrictMode, filter customer, ganti tab lain) sering
       memanggil ini dengan rentang yang sama. Tanpa penjaga, satu klik
       = satu query penuh. */
    if (rentangTerakhir.current === kunci) return;
    rentangTerakhir.current = kunci;
    const token = ++rentangToken.current;
    const cacheKey = `rentang:${kunci}`;
    const masihJalan = token === rentangToken.current;

    /* 1. Isi layar dari cache lebih dulu — ini yang bikin pindah tab terasa
          seketika, bukan menunggu query. */
    const cached = await cacheBaca<{ sales: SaleRow[]; items: [number, SaleItemRow[]][] }>(cacheKey);
    if (cached?.data && masihJalan) {
      setSalesRentang(cached.data.sales);
      try {
        setStruk(strukUntukUI(cached.data.sales, keItemRows(cached.data.items)));
      } catch {
        // Bentuk cache tidak cocok dengan kode sekarang: abaikan, tarik ulang.
      }
    }

    /* 2. Tarik data asli diam-diam; layar tetap menampilkan yang cached
          sampai hasil baru datang. */
    try {
      const { sales, items } = await ambilStruk(dari, sampai);
      if (!masihJalan) return;
      setSalesRentang(sales);
      setStruk(strukUntukUI(sales, items));
      await cacheTulis(cacheKey, { sales, items: [...items.entries()] });
    } catch (e) {
      // Cache sudah menampilkan sesuatu: kegagalan jaringan tidak boleh
      // mengosongkan layar.
      if (!cached?.data) setError((e as Error).message);
      rentangTerakhir.current = null;
    }
  }, []);

  /* Tarik ulang paksa untuk rentang yang sama, dan buang cache-nya dulu.
   *
   * WAJIB ada begitu ada fitur yang MENULIS. Setelah hapus atau restore
   * struk, cache IndexedDB masih berisi data lama, dan penjaga
   * `rentangTerakhir.current === kunci` membuat permintaan dengan rentang
   * yang sama langsung return. Akibatnya tabelnya tetap nampilin struk yang
   * baru saja dihapus dan tab "Terhapus" tetap kosong — jadi kelihatan
   * seperti tombolnya tidak bekerja.
   *
   * Cache dibuang lebih dulu, bukan sesudah: kalau cache lama dipakai
   * mengisi layar, layar sempat menampilkan data basi sebelum request
   * selesai, dan itu yang paling bikin kesal. */
  const segarkanRentang = useCallback(
    async (dari?: string, sampai?: string) => {
      await cacheHapus(`rentang:${dari ?? ""}|${sampai ?? ""}`);
      rentangTerakhir.current = null;
      await muatRentang(dari, sampai);
    },
    [muatRentang],
  );
  /* Dipanggil setelah halaman lain menulis ke Supabase.
   *
   * Tanpa ini, hasil import tidak muncul di Penjualan: cache rentang masih
   * berisi data sebelum import, dan penjaga `rentangTerakhir` menganggap
   * rentang itu sudah diambil sehingga tidak menarik lagi. Beranda ikut
   * benar karena KPI-nya dibaca dari riwayat penuh, jadi gejalanya menarik:
   * dashboard terlihat masuk, laporan tidak. */
  const invalidasiSetelahTulis = useCallback(async () => {
    await cacheHapusAwalan("rentang:");
    await cacheHapus("ringkas30");
    rentangTerakhir.current = null;
    ringkasJalan.current = false;
  }, []);

  /* Beranda butuh 30 hari terakhir beserta sale_items-nya. Berbeda dengan
     muatRentang(): hasilnya tidak pernah ditulis ke salesMentah/struk, jadi
     membuka halaman Penjualan tidak akan mengubah kartu Beranda. */
  const muatRingkas = useCallback(async () => {
    if (ringkasJalan.current) return;
    ringkasJalan.current = true;
    try {
      const n = new Date();
      const t = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dari = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 29);
      /* "Menu Terlaris" & "Struk Terbaru" adalah dua kartu yang paling lambat
         muncul karena butuh 30 hari struk beserta sale_items-nya. Dari cache
         keduanya langsung ada; yang terbaru menyusul. */
      const cached = await cacheBaca<{ sales: SaleRow[]; items: [number, SaleItemRow[]][] }>("ringkas30");
      if (cached?.data) setRingkasStruk(strukUntukUI(cached.data.sales, keItemRows(cached.data.items)));
      const { sales, items } = await ambilStruk(t(dari), t(n));
      setRingkasStruk(strukUntukUI(sales, items));
      await cacheTulis("ringkas30", { sales, items: [...items.entries()] });
    } catch (e) {
      // Gagal di sini bukan alasan menggagalkan seluruh aplikasi; kartu
      // Beranda akan menampilkan keadaan kosong.
      ringkasJalan.current = false;
      setError((e as Error).message);
    }
  }, []);

  /* Isi layar dari cache, lalu tarik yang terbaru diam-diam.
   *
   * Dahulu aplikasi membuka dengan menarik 2.129 struk sebelum layar boleh
   * terisi. Sekarang urutannya dibalik: cache mengisi layar (saldi
   *ency milliseconds), lalu request berjalan di belakang. Kasir tidak pernah
   * menunggu, dan angka tetap benar begitu request selesai. */
  const muatInti = useCallback(async () => {
    setError(null);

    const cached = await cacheBaca<{
      sales: SaleRow[];
      customers: CustomerRow[];
      customerAlias: AliasCustomer[];
    }>("inti");
    if (cached?.data) {
      setInti({ ...cached.data, diambilPada: new Date(cached.ts) });
      setStatus("live");
    } else if (!intiRef.current) {
      /* "memuat" HANYA saat belum ada apa pun di layar. Kalau sudah ada
         data dari run sebelumnya, entering "memuat" akan mengosongkan
         seluruh aplikasi selama network — termasuk daftar draft impor
         yang sedang dikerjakan kasir. Memakai cache yang basi sesaat
         jauh lebih baik daripada layar kosong. */
      setStatus("memuat");
    }

    try {
      /* Pelanggan dulu: 318 baris, cepat, dan hampir semua halaman butuh. */
      const d = await ambilInti();
      setInti((lama) => ({ ...d, sales: lama?.sales ?? [], diambilPada: new Date() }));
      setStatus("live");

      /* Riwayat penjualan menyusul. Ini yang berat (3 permintaan, ~3 detik)
         dan hanya dipakai Beranda untuk KPI bulan & piutang — jadi tidak
         boleh memblokir halaman yang sudah terisi. */
      const sales = await ambilSales();
      setInti((lama) => (lama ? { ...lama, sales } : lama));
      await cacheTulis("inti", {
        sales,
        customers: d.customers,
        customerAlias: d.customerAlias,
      });
    } catch (e) {
      if (cached?.data) return; // masih ada yang tampil
      setError((e as Error).message);
      setInti(null);
      setStruk([]);
      setSalesRentang([]);
      setStatus("gagal");
    }
  }, []);

  /* Tarik ulang setelah ada yang MENULIS, tanpa mengosongkan apa pun.
   *
   * `muatUlang` (muatSemuanya) menghapus cache inti + produk lalu menarik
   * 1.095 produk + 3.297 varian dari nol. Itu sekitar 4 detik, dan selama
   * itu katalog kosong — sehingga setiap "Pilih Barang" di daftar draft
   * ikut jadi tidak bisa dipakai, persis saat kasir sedang memproses.
   *
   * Import struk tidak butuh katalog: yang berubah hanya sales (untuk
   * Dashboard Penjualan + KPI Beranda) dan ringkasan 30 hari. Keduanya
   * bisa ditarik ulang tanpa menyentuh produk. */
  const perbaruiSetelahTulis = useCallback(async () => {
    await invalidasiSetelahTulis();
    /* Cache inti juga basi: isinya riwayat penjualan penuh yang jadi
       sumber KPI Beranda dan "ongkir lama customer". */
    await cacheHapus("inti");
    await muatInti();
    await muatRingkas();
  }, [invalidasiSetelahTulis, muatInti, muatRingkas]);

  /* Tahap 2: baru jalan ketika ada yang benar-benar butuh katalog. */
  const pastikanProduk = useCallback(() => {
    setProdukDipinta(true);
    if (produkJalan.current) return;
    if (produkData && !isProdukStale()) return;
    produkJalan.current = true;
    void (async () => {
      try {
        /* 1. dari cache — isi layar seketika (hanya kalau belum punya data). */
        if (!produkData) {
          const cache = await bacaCacheProduk();
          if (cache) setProdukData(cache);
        }
        /* 2. Tarik dari Supabase kalau cache basi atau katalog ditandai basi.
              Sync Google Sheet mungkin baru saja selesai dan menandai cache basi. */
        if (isProdukStale() || !(await cacheProdukMasihSegar())) {
          const d = await ambilProdukSekali();
          setProdukData(d);
          await tulisCacheProduk(d);
          resetProdukStale();
        }
      } catch (e) {
        /* Gagal — biarkan produkStale tetap true supaya dicoba lagi nanti. */
        setError((e as Error).message);
      } finally {
        produkJalan.current = false;
        /* Sync mungkin selesai saat kita sedang menarik data — kalau
           produkStale masih / sudah true, schedule pengambilan ulang. */
        if (isProdukStale()) setTimeout(pastikanProduk, 0);
      }
    })();
  }, [produkData]);

  /* Muat ulang total = inti + katalog lagi. */
  const muatSemuanya = useCallback(async () => {
    produkBerjalan = null;
    produkJalan.current = false;
    setProdukData(null);
    resetProdukStale();
    rentangTerakhir.current = null;
    await cacheHapus("inti", "produk");
    await muatInti();
    const d = await ambilProdukSekali().catch(() => null);
    if (d) {
      setProdukData(d);
      tulisCacheProduk(d);
    }
  }, [muatInti]);

  useEffect(() => {
    if (!aktif) return;
    void muatInti();
    void muatRingkas();
    // Dimuat sekali saat aplikasi dibuka.
  }, [aktif, muatInti, muatRingkas]);

  /* Daftarkan panggilan ulang katalog saat sync menandai basi. */
  useEffect(() => {
    return padaProdukStale(() => pastikanProduk());
  }, [pastikanProduk]);

  const nilai = useMemo<Toko>(() => {
    if (status === "live" && inti) {
      /* Baris kembar dari impor Google Sheet digabung di sini, bukan di
         tiap halaman, supaya Kasir maupun Kelola Menu menghitung menu yang
         sama dengan cara yang sama. */
      const produkUI = produkData
        ? gabungProdukKembar(produkUntukUI(produkData.products, produkData.varian)).produk
        : [];
      return {
        status,
        error,
        struk,
        customers: customerUntukUI(inti.customers, inti.sales),
        customerAlias: inti.customerAlias ?? [],
        produkSiap: produkUI.length > 0,
        produkDimuat: produkData !== null,
        produkMemuat: produkDipinta && produkData === null,
        products: produkData?.products ?? [],
        varian: produkData?.varian ?? new Map<string, VarianProduk[]>(),
        produk: produkUI,
        salesMentah: salesRentang,
        salesSemua: inti.sales,
        ringkasStruk,
        diambilPada: inti.diambilPada,
        pastikanProduk,
        muatRentang,
        segarkanRentang,
        invalidasiSetelahTulis,
        perbaruiSetelahTulis,
        muatUlang: muatSemuanya,
      };
    }
    return {
      status,
      error,
      ...KOSONG,
      produkSiap: false,
      produkDimuat: false,
      produkMemuat: produkDipinta && produkData === null,
      diambilPada: null,
      pastikanProduk,
      muatRentang,
      segarkanRentang,
      invalidasiSetelahTulis,
      perbaruiSetelahTulis,
      muatUlang: muatSemuanya,
    };
  }, [status, error, inti, struk, salesRentang, ringkasStruk, produkData, produkDipinta, pastikanProduk, muatRentang, segarkanRentang, invalidasiSetelahTulis, perbaruiSetelahTulis, muatSemuanya]);

  return <Ctx.Provider value={nilai}>{children}</Ctx.Provider>;
}

export function useData(): Toko {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData harus dipakai di dalam <DataProvider>");
  return v;
}
