import { SUPABASE_URL, headerRest, supabase } from "@/supabase/client";
import {
  VARIAN_BLOB_PREFIX,
  type CustomerRow,
  type ProductRow,
  type ProductVariantRow,
  type SaleItemRow,
  type SaleRow,
} from "@/supabase/types";
import type { Product as MenuProduk } from "./menu-seed";
import type { PricingType } from "./pricing";
import {
  flag,
  kategoriProduk,
  mapCustomer,
  mapStruk,
  rekapPerCustomer,
  varianNormal,
  varianUntukProduk,
  type VarianProduk,
} from "./live-mappers";

/* ==========================================================================
   Pengambilan data dari Supabase.

   Dua hal yang wajib diingat:
     1. PostgREST memotong di 1.000 baris per permintaan..products ada 1.095
        dan sale_items 5.715, jadi halaman wajib dipaginasi. Semuanya
        di sini lewat helper `ambilSemua`.
     2. Modul ini boleh gagal. Kegagalan tidak boleh menjatuhkan aplikasi:
        pemanggil memutuskan pakai data live atau dummy.
   ========================================================================== */

const UKURAN_HALAMAN = 1000;

async function ambilSemua<T>(
  namaTabel: string,
  pilih: string,
  /** PostgREST: order by kolom pertama, lalu Range untuk ambil berikutnya. */
  urutKolom: string,
  batas?: number,
): Promise<T[]> {
  const hasil: T[] = [];
  let mulai = 0;

  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${namaTabel}`);
    url.searchParams.set("select", pilih);
    url.searchParams.set("order", `${urutKolom}.asc`);
    url.searchParams.set("offset", String(mulai));
    url.searchParams.set("limit", String(UKURAN_HALAMAN));

    const r = await fetch(url, {
      headers: {
        ...headerRest(),
        Range: `${mulai}-${mulai + UKURAN_HALAMAN - 1}`,
      },
    });
    if (!r.ok) throw new Error(`${namaTabel}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);

    const halaman = (await r.json()) as T[];
    hasil.push(...halaman);
    mulai += UKURAN_HALAMAN;

    if (halaman.length < UKURAN_HALAMAN) break;
    if (batas !== undefined && hasil.length >= batas) return hasil.slice(0, batas);
    // Jaring pengaman: kalau server mengabaikan offset, kita akan melihat
    // baris yang sama berulang. Berhenti daripada looping tanpa henti.
    if (mulai > 200_000) break;
  }
  return hasil;
}

/* -------------------------------------------------------------------------
   Struk + baris item
   ---------------------------------------------------------------------- */

/* Batas bawah & atas expressed sebagai UTC penuh ("2026-09-29T17:00:00Z"),
   karena completed_at bertipe timestamptz. Tanpa konversi ini, "hari ini"
   dihitung dari tengah malam UTC — 7 jam sebelum tengah malam kasir — dan
   struklarut tidak masuk, struk besok ikut masuk.
   Pemanggil mengirim tanggal lokal (YYYY-MM-DD); konversinya di sini supaya
   satu tempat yang perlu diubah kalau zona waktu kasir berubah. */
const ZONA_WAKTU_KASIR = 7; // WIB

export function batasRentangUTC(tanggal: string, awal: boolean): string {
  const tengahMalamUTC = new Date(`${tanggal}T00:00:00Z`);
  if (Number.isNaN(tengahMalamUTC.getTime())) return `${tanggal}T00:00:00Z`;
  // tengah malam kasir = tengah malam UTC dikurangi zona waktu kasir
  const tengahMalamKasir = tengahMalamUTC.getTime() - ZONA_WAKTU_KASIR * 3_600_000;
  return new Date(awal ? tengahMalamKasir : tengahMalamKasir + 86_399_999).toISOString();
}

/** Sales dipetik antara `dari` dan `sampai` (YYYY-MM-DD waktu kasir) supaya
    halaman laporan tidak menarik 2.129 baris setiap kali filter tanggal
    berubah. Tanpa batas bawah, semua tab Harian/Mingguan/Bulanan sebenarnya
    menampilkan seluruh riwayat. */
export async function ambilStruk(dari?: string, sampai?: string): Promise<{
  sales: SaleRow[];
  items: Map<number, SaleItemRow[]>;
}> {
  const kolom =
    "id,receipt_no,completed_at,store_name,payment,subtotal,discount,tax,total," +
    "customer_name,customer_address,order_note,due_text,chat_date,deleted_at," +
    "stock_restored_on_delete,paid_amount,created_at,queue_no,queue_date,send_note";

  /* Paginasi wajib: PostgREST memotong 1.000 baris, dan satu bulan busiest
     bisa melampauinya — tanpa ini, KOT dan total omzet diam-diam kehilangan
     struk. */
  const sales: SaleRow[] = [];
  let mulai = 0;
  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
    url.searchParams.set("select", kolom);
    url.searchParams.set("order", "completed_at.desc");
    /* append, bukan set: set untuk key yang sama menimpa filter sebelumnya,
       jadi `completed_at` hanya tersisa batas atas dan rentang bawah hilang. */
    if (dari) url.searchParams.append("completed_at", `gte.${batasRentangUTC(dari, true)}`);
    if (sampai) url.searchParams.append("completed_at", `lte.${batasRentangUTC(sampai, false)}`);

    const r = await fetch(url, {
      headers: { ...headerRest(), Range: `${mulai}-${mulai + UKURAN_HALAMAN - 1}` },
    });
    if (!r.ok) throw new Error(`sales: HTTP ${r.status}`);

    const halaman = (await r.json()) as SaleRow[];
    sales.push(...halaman);
    mulai += UKURAN_HALAMAN;
    if (halaman.length < UKURAN_HALAMAN) break;
  }

  const items = await ambilItemUntuk([...sales.map((s) => s.id)]);
  return { sales, items };
}

/** sale_items diambil per-potongan sale_id. Query `in` punya batas panjang
    URL, jadi dipecah 200 id per permintaan. */
async function ambilItemUntuk(ids: number[]): Promise<Map<number, SaleItemRow[]>> {
  const hasil = new Map<number, SaleItemRow[]>();
  if (ids.length === 0) return hasil;

  const kolom =
    "id,sale_id,sku,name,price,quantity,line_total,note,product_client_id," +
    "variant_client_id,menu_name,variant_name,unit_name,unit_quantity,pricing_type,receipt_label";

  for (let i = 0; i < ids.length; i += 200) {
    const potong = ids.slice(i, i + 200);
    const url = new URL(`${SUPABASE_URL}/rest/v1/sale_items`);
    url.searchParams.set("select", kolom);
    url.searchParams.set("sale_id", `in.(${potong.join(",")})`);
    url.searchParams.set("order", "id.asc");

    const r = await fetch(url, { headers: headerRest() });
    if (!r.ok) throw new Error(`sale_items: HTTP ${r.status}`);

    for (const row of (await r.json()) as SaleItemRow[]) {
      const l = hasil.get(row.sale_id) ?? [];
      l.push(row);
      hasil.set(row.sale_id, l);
    }
  }
  return hasil;
}

/* -------------------------------------------------------------------------
   Customer
   ---------------------------------------------------------------------- */

export async function ambilCustomer(): Promise<CustomerRow[]> {
  // 318 baris, muat dalam satu halaman.
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`customers: ${error.message}`);
  return (data ?? []) as CustomerRow[];
}

/* Alias customer — nama lain yang dipakai kasir untuk customer yang sama.
 *
 * Contoh nyata: "Bhas Sari 38" → "Bhaskara sari 38", "N - 2" → "ITS N 2".
 * Kasir lebih sering mengetik alias daripada nama formal, jadi tanpa ini
 * dropdown di keranjang hanya menampilkan 327 nama yang tidak pernah
 * diketik siapa pun.
 *
 * `customer_id` ikut diambil karena inilah yang mengikat alias ke nama
 * asli. Tanpa itu, alias jadi daftar string yang tidak ada induknya —
 * dan "Bhas Sari 38" bisa cocok ke customer yang mana saja yang namanya
 * mengandung "bhas". */
export type AliasCustomer = {
  customer_id: number;
  alias: string;
};

export async function ambilCustomerAlias(): Promise<AliasCustomer[]> {
  const { data, error } = await supabase
    .from("customer_aliases")
    .select("customer_id,alias")
    .limit(2000);
  if (error) throw new Error(`customer_aliases: ${error.message}`);
  return ((data ?? []) as AliasCustomer[]).filter(
    (r) => typeof r?.alias === "string" && r.alias.trim() !== "",
  );
}

/** Rekap order per customer butuh seluruh sales, jadi dipanggil sekali
    bersama pemuatan awal — bukan per render. */
export async function ambilSalesSemua(): Promise<SaleRow[]> {
  /* Hanya kolom yang dipakai agregasi. receipt_no, store_name, chat_date,
     dan seterusnya tidak dibaca di mana pun dan menambah ukuran payload
     untuk 2.129 baris. */
  return ambilSemua<SaleRow>(
    "sales",
    "id,receipt_no,completed_at,payment,subtotal,discount,tax,total,customer_name,paid_amount,deleted_at",
    "id",
  );
}

/* -------------------------------------------------------------------------
   Produk + varian
   ---------------------------------------------------------------------- */

export type DataProduk = {
  products: ProductRow[];
  /** Baris product_variants mentah — disimpan supaya cache sesi bisa
      membangun ulang peta varian tanpa query kedua. */
  varianBaris: ProductVariantRow[];
  varian: Map<string, VarianProduk[]>;
};

export async function ambilProduk(): Promise<DataProduk> {
  // products = 1.095 baris, melewati batas 1.000. WAJIB dipaginasi.
  const products = await ambilSemua<ProductRow>(
    "products",
    "id,client_id,sku,name,price,stock,stock_unlimited,category,aliases,source,updated_at",
    "id",
  );

  const barisVarian = await ambilSemua<ProductVariantRow>(
    "product_variants",
    "id,client_id,product_client_id,name,pricing_type,price,unit_name,package_quantity," +
      "package_unit,receipt_label,is_default,allow_quantity_override,allow_price_override," +
      "stock,stock_unlimited,aliases,sort_order,active,updated_at",
    "id",
  );

  const varian = new Map<string, VarianProduk[]>();
  for (const p of products) {
    varian.set(p.client_id, varianUntukProduk(p, barisVarian));
  }
  return { products, varianBaris: barisVarian, varian };
}

/* -------------------------------------------------------------------------
   Bentuk akhir yang dipakai UI
   ---------------------------------------------------------------------- */

/* Inti = yang dibutuhkan SEMUA halaman. Produk & varian sengaja TIDAK
   ikut di sini: hanya /kasir dan /menu yang memakainya, dan menariknya
   sejak aplikasi dibuka menambah ±4,4 detik sebelum halaman pertama selesai.
   Lihat pastikanProduk() di data-source. */
export type DataInti = {
  sales: SaleRow[];
  customers: CustomerRow[];
  /** Nama lain yang dipakai kasir untuk customer yang sama, terikat ke
      customer aslinya lewat `customer_id`. Untuk mencari; yang tersimpan
      ke struk tetap nama asli. */
  customerAlias: AliasCustomer[];
  /** Dipakai buat menampilkan waktu ambil di topbar. */
  diambilPada: Date;
};

/* Dipecah, bukan di-Promise.all sekaligus.
 *
 * Pelanggan = 318 baris, selesai dalam ~0,5 detik dan dibutuhkan hampir
 * semua halaman. Riwayat penjualan = 2.129 baris, butuh 3 permintaan dan
 * ~3 detik, dan hanya Beranda (untuk KPI bulan & piutang) yang memakainya.
 * Kalau keduanya ditunggu bareng, layar baru terisi setelah yang lambat —
 * padahal yang cepat sudah tersedia lebih dulu.
 *
 * Karena itu halaman.NONE lagi menarik "semua" di awal: yang berat diambil
 * setelah layar terisi, diam-diam, dan hasilnya disimpan. */
export async function ambilInti(): Promise<DataInti> {
  const customers = await ambilCustomer();
  /* Alias ditunggu sendiri, setelah customers sampai. Kasir bisa langsung
     mulai mengetik nama begitu daftar customer muncul; alias hanya
     melengkapi daftar pencarian, dan kehadirannya tidak boleh terasa
     sebagai jeda. */
  const customerAlias = await ambilCustomerAlias();
  return { sales: [], customers, customerAlias, diambilPada: new Date() };
}

/** Riwayat penjualan penuh (kolom ramping). Dipanggil terpisah, setelah
    layar sudah terisi. */
export async function ambilSales(): Promise<SaleRow[]> {
  return ambilSalesSemua();
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Produk siap pakai untuk Kelola Menu & Kasir.
 *
 * Varian dari Supabase dilengkapi default untuk kolom yang tidak diambil
 * (allow_* tidak ada di product_variants) supaya tidak pernah undefined
 * lalu di.nil dibandingkan. */
export function produkUntukUI(products: ProductRow[], varian: Map<string, VarianProduk[]>): MenuProduk[] {
  return products
    .map((p) => ({
      client_id: p.client_id,
      name: p.name,
      sku: p.sku ?? "",
      category: kategoriProduk(p.category),
      aliases: parseAliases(p.aliases),
      stock: n(p.stock),
      stock_unlimited: flag(p.stock_unlimited),
      variants: (varian.get(p.client_id) ?? [varianNormal(p.client_id, p.price)]).map((v) => ({
        client_id: v.client_id,
        name: v.name,
        pricing_type: (v.pricing_type || "fixed") as PricingType,
        price: v.price,
        unit_name: v.unit_name || "",
        package_quantity: v.package_quantity || 1,
        receipt_label: v.receipt_label || "",
        is_default: v.is_default,
        allow_quantity_override: true,
        allow_price_override: false,
        active: v.active,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
}

/* -------------------------------------------------------------------------
   Produk kembar.

   Impor dari Google Sheet menyalin baris yang sama berkali-kali: "Oseng
   Tahu Tempe 1/2" ada 146 kali, semuanya Rp 10.000; "Asem Asem Daging"
   dua kali. Di daftar kasir itu tampil sebagai kartu kembar, dan kasir bisa
   saja memanggil "Asem Asem Daging" dua kali untuk satu menu.

   Yang digabung HANYA baris yang identik: nama, harga, kategori, dan daftar
   varian sama persis. Dua produk dengan nama sama tapi harga beda (mis.
   "Pepes Tongkol" Rp 5.000 dan Rp 20.000) itu dua menu berbeda dan tetap
   ditampilkan terpisah — menggabungkan cuma demi nama akan diam-diam
   memilih satu harga, dan produk yang lain hilang dari daftar.

   client_id yang dipertahankan adalah yang pertama pada urutan nama, jadi
   hasilnya deterministik dan tidak berganti-berganti tiap muat.
   ---------------------------------------------------------------------- */

/* --------------------------------------------------------------
   Aturan penggabungan.

   Dua baris dianggap produk yang sama kalau:
     - nama sama (spasi & huruf besar diabaikan), dan
     - harga varian AKTIF-nya sama persis.

   Dua hal sengaja TIDAK dipakai sebagai pembeda:
     - nama varian. Baris kembar sering menulis varian sama dengan nama
       berbeda — satu "Separuh", yang lain "1/2", keduanya Rp 17.500.
       Kalau nama varian jadi pembeda, dua kartu tetap muncul terpisah dan
       kasir tidak pernah tahu itu satu menu.
     - varian nonaktif. "Normal" yang dimatikan di satu baris tidak
       mengubah apa yang bisa dipesan.

   Kategori TIDAK dipakai sebagai pembeda. Impor dari Google Sheet mengisi
   kategori hanya sebagian baris, sehingga "Sambel Tumpang" bisa muncul
   sebagai "Pelengkap" dan "Lainnya" sekaligus. Nama sama + harga sama +
   varian sama sudah cukup untuk menyatakan itu satu menu; kategori yang
   dipakai adalah kategori terisi pertama, dan bukan yang terakhir.
   ------------------------------------------------------------------ */

function namaNormal(nama: string): string {
  return nama.trim().replace(/\s+/g, " ").toLowerCase();
}

/* Varian aktif = yang bisa dipilih kasir, jadi itulah yang boleh memisahkan
   dua produk. Varian custom ikut karena tipenya berbeda. */
function sidikVarian(p: MenuProduk): string {
  return p.variants
    .filter((v) => v.active)
    .map((v) => `${v.pricing_type}@${v.price}`)
    .sort()
    .join("|");
}

/* Penting: kategori sudah dinormalisasi lebih dulu oleh kategoriProduk(),
   jadi baris tanpa kategori muncul sebagai "Tanpa Kategori", bukan string
   kosong. Kalau hanya "" yang dianggap kosong, membandingkan "" tidak akan
   pernah terjadi dan kembar tetap muncul. */
const TANPA_KATEGORI = "Tanpa Kategori";

/* Kategori hasil penggabungan: pakai yang terisi, jangan yang kosong —
   "Tanpa Kategori" hanya ada karena impor tidak selalu mengisi. */
function gabungKategori(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  const kosong = (v: string) => v === "" || v === TANPA_KATEGORI;
  if (kosong(x)) return y;
  return x;
}

export type HasilGabung = { produk: MenuProduk[]; digabung: number };

export function gabungProdukKembar(produk: MenuProduk[]): HasilGabung {
  const hasil: MenuProduk[] = [];
  let digabung = 0;

  for (const p of produk) {
    const nama = namaNormal(p.name);
    const sidik = sidikVarian(p);
    const cocok = hasil.findIndex(
      (h) => namaNormal(h.name) === nama && sidikVarian(h) === sidik,
    );

    if (cocok < 0) {
      hasil.push(p);
      continue;
    }

    digabung += 1;
    /* Nama varian yang berbeda tidak dibuang: masuk ke `aliases` supaya
       mengetik "1/2" tetap menemukan produknya. */
    const lama = hasil[cocok];
    const kategoriBaru = gabungKategori(lama.category, p.category);
    if (kategoriBaru !== lama.category) {
      hasil[cocok] = { ...lama, category: kategoriBaru };
    }
    const tambahan = p.variants
      .map((v) => v.name)
      .filter((n) => !lama.variants.some((v) => v.name === n));
    if (tambahan.length === 0) continue;
    hasil[cocok] = {
      ...hasil[cocok],
      aliases: [...new Set([...hasil[cocok].aliases, ...tambahan.map((n) => n.toLowerCase())])],
    };
  }

  return { produk: hasil, digabung };
}


/** Kolom aliases produk berisi JSON daftar alias — kecuali yang diawali
    prefix varian, karena itu bukan alias. */
function parseAliases(aliases: string | null): string[] {
  if (!aliases || aliases.startsWith(VARIAN_BLOB_PREFIX)) return [];
  try {
    const arr = JSON.parse(decodeURIComponent(aliases));
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/** Struk siap pakai untuk UI (sudah di-mapping ke bentuk Sale). */
export function strukUntukUI(sales: SaleRow[], items: Map<number, SaleItemRow[]>) {
  return sales.map((s) => mapStruk(s, items.get(s.id) ?? []));
}

/** Customer siap pakai untuk UI, dilengkapi rekap order. */
export function customerUntukUI(customers: CustomerRow[], sales: SaleRow[]) {
  const rekap = rekapPerCustomer(sales);
  return customers.map((c) => {
    const r = rekap.get(String(c.name).trim());
    return mapCustomer(c, r ? { orderCount: r.orderCount, total: r.total, last: r.last } : undefined);
  });
}
