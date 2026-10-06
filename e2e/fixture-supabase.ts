import type { Page } from "@playwright/test";

/* ==========================================================================
   A fake Supabase for the E2E suite.

   Why this exists: these specs used to read the production database, because
   the publishable key could read anything. Now that RLS is closed, anon gets
   nothing — so a suite that depends on live rows would stop passing the
   moment the database is secured, which is backwards. The deploy gate would
   break the build that makes the database safe.

   Intercepting PostgREST also makes the suite deterministic. "Anak 7/37"
   existing in the real customers table is not a property of the app; it is a
   property of one shop's data at one moment.
   ========================================================================== */

type Customer = {
  id: number;
  name: string;
  default_shipping: number;
  last_order_at: string | null;
  created_at: string;
  updated_at: string;
  deposit_balance: number;
  tag: string | null;
};

type Alias = { customer_id: number; alias: string };

type Product = {
  id: number;
  client_id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
  stock_unlimited: number;
  category: string;
  aliases: string | null;
  source: string;
  updated_at: string;
};

/** One customer whose name differs from its alias, which is the whole point
 *  of the alias table: typing the alias must surface the real name. */
export const CUSTOMER_ALIAS_TUJUH = "Bhaskara sari 38";
export const ALIAS_SUMBER = "Bhas Sari 38";

/** Has `default_shipping`, so the ongkir autofill path is exercised. */
export const CUSTOMER_ONGKIR = "Tenggilis Ratu 12";
export const ONGKIR_NILAI = 35000;

export const CUSTOMER_PLAIN = "Anak 7/37";

const CUSTOMER: Customer[] = [
  {
    id: 1,
    name: CUSTOMER_PLAIN,
    default_shipping: 0,
    last_order_at: "2026-06-01T02:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-06-01T02:00:00.000Z",
    deposit_balance: 0,
    tag: "Sutorejo",
  },
  {
    id: 2,
    name: CUSTOMER_ALIAS_TUJUH,
    default_shipping: 0,
    last_order_at: "2026-06-02T02:00:00.000Z",
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-06-02T02:00:00.000Z",
    deposit_balance: 0,
    tag: "ITS",
  },
  {
    id: 3,
    name: CUSTOMER_ONGKIR,
    default_shipping: ONGKIR_NILAI,
    last_order_at: "2026-06-03T02:00:00.000Z",
    created_at: "2026-01-03T00:00:00.000Z",
    updated_at: "2026-06-03T02:00:00.000Z",
    deposit_balance: 0,
    tag: "Kenjeran",
  },
  {
    id: 4,
    name: "ITS Nano Technology 4",
    default_shipping: 15000,
    last_order_at: "2026-06-04T02:00:00.000Z",
    created_at: "2026-01-04T00:00:00.000Z",
    updated_at: "2026-06-04T02:00:00.000Z",
    deposit_balance: 0,
    tag: "ITS",
  },
];

const ALIAS: Alias[] = [
  { customer_id: 2, alias: ALIAS_SUMBER },
  { customer_id: 2, alias: "bhas sari 38" },
];

const PRODUCT: Product[] = [
  {
    id: 1,
    client_id: "p-nasi-goreng",
    sku: "NG01",
    name: "Nasi Goreng Rumahan",
    price: 35000,
    stock: 20,
    stock_unlimited: 0,
    category: "Rumah",
    aliases: JSON.stringify(["nasi goreng"]),
    source: "test",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    client_id: "p-ayam-goreng",
    sku: "AG02",
    name: "Ayam Goreng",
    price: 30000,
    stock: 15,
    stock_unlimited: 0,
    category: "Rumah",
    aliases: null,
    source: "test",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 3,
    client_id: "p-soto-madura",
    sku: "SM03",
    name: "Soto Madura",
    price: 28000,
    stock: 0,
    stock_unlimited: 1,
    category: "Rumah",
    aliases: null,
    source: "test",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

const VARIAN = [
  {
    id: 1,
    client_id: "p-nasi-goreng",
    product_client_id: "p-nasi-goreng",
    name: "Normal",
    pricing_type: "fixed",
    price: 35000,
    unit_name: "bungkus",
    package_quantity: 1,
    package_unit: "bungkus",
    receipt_label: "",
    is_default: 1,
    allow_quantity_override: 1,
    allow_price_override: 0,
    stock: 20,
    stock_unlimited: 0,
    aliases: null,
    sort_order: 0,
    active: 1,
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  /* A custom-priced variant, because kasir.tsx treats `pricing_type:
     "custom"` as a line the cashier types the price into — and that path
     has its own guard against paying an unfinished cart. */
  {
    id: 2,
    client_id: "p-ayam-goreng",
    product_client_id: "p-ayam-goreng",
    name: "Custom",
    pricing_type: "custom",
    price: 0,
    unit_name: "bungkus",
    package_quantity: 1,
    package_unit: "bungkus",
    receipt_label: "",
    is_default: 0,
    allow_quantity_override: 1,
    allow_price_override: 1,
    stock: 15,
    stock_unlimited: 0,
    aliases: null,
    sort_order: 1,
    active: 1,
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

/** First variant button in the catalog — always a fixed-price one, so a
 *  subtotal assertion has something meaningful to assert. */
export const VARIAN_PILIH = "Normal";

/** The custom-priced variant. `pricing_type: "custom"` is what makes
 *  kasir.tsx treat the line as cashier-priced. */
export const VARIAN_CUSTOM = "Custom";

/** Satu struk yang bisa dipakai spec yang perlu melihat daftar struk. */
export const SALE_FIXTURE = {
  id: 1,
  receipt_no: "SH-20261006-0043",
  completed_at: "2026-10-06T02:49:00.000Z",
  store_name: "Shanti Catering",
  payment: "Tunai",
  subtotal: 35_000,
  discount: 0,
  tax: 0,
  total: 35_000,
  customer_name: "Customer Fixture",
  customer_address: "",
  order_note: "",
  due_text: "",
  chat_date: "",
  deleted_at: null,
  stock_restored_on_delete: 0,
  paid_amount: 35_000,
  created_at: "2026-10-06T02:49:00.000Z",
  queue_no: 1,
  queue_date: "2026-10-06",
  send_note: "",
};

const TABEL: Record<string, unknown[]> = {
  customers: CUSTOMER,
  customer_aliases: ALIAS,
  products: PRODUCT,
  product_variants: VARIAN,
  sales: [],
  sale_items: [],
  sale_payments: [],
};

/* Baris item dari struk fixture. SaleLine tidak bisa dibuat tanpa `id`
   (primary key baris di `sale_items`), jadi di sini ada. */
const SALE_BARIS = {
  id: 1,
  sale_id: 1,
  sku: "",
  name: "Nasi Goreng Rumahan",
  price: 35_000,
  quantity: 1,
  line_total: 35_000,
  note: "",
  product_client_id: "p-nasi-goreng",
  variant_client_id: "",
  menu_name: "Nasi Goreng Rumahan",
  variant_name: "Normal",
  unit_name: "",
  unit_quantity: null,
  pricing_type: "fixed",
  receipt_label: "",
};

/* Tiga customer dari data nyata yang kolom Tag-nya dulu tampil kosong.

   Bentuknya berbeda-beda, dan itu justru inti masalahnya:

   1. "Anis BTH" — kolom tag kosong, tag tersimpan di alias
      `tagalamat:ITS`, dan namanya sendiri tidak memuat kata area
      sama sekali.
   2. "Managemen Bisnis Ayu" — namanya salah ketik di database (kurang
      'e'), sedangkan struk memakai ejaan yang benar, jadi cocok persis
      gagal. Kata "ITS"-nya ada di alias `Gedung FKK ITS Lt 2`.
   3. "Inayati" — nama dan alias-nya tidak memuat kata area apa pun.
      Satu-satunya sumber tag adalah alias `tagalamat:ITS`.

   Ketiganya harus menampilkan area. Kalau ada yang kembali kosong, yang
   rusak bukan kolom Tag tapi pemetaan nama-ke-area di lib/kurir.ts. */
export const CUSTOMER_TAG_DI_ALIAS = [
  {
    id: 126,
    name: "Anis BTH",
    default_shipping: 5000,
    last_order_at: null,
    created_at: "2026-01-09T00:00:00.000Z",
    updated_at: "2026-01-09T00:00:00.000Z",
    deposit_balance: 0,
    tag: null,
  },
  {
    id: 201,
    name: "Managemen Bisnis Ayu",
    default_shipping: 5000,
    last_order_at: null,
    created_at: "2026-01-09T00:00:00.000Z",
    updated_at: "2026-01-09T00:00:00.000Z",
    deposit_balance: 0,
    tag: null,
  },
  {
    id: 1969,
    name: "Inayati",
    default_shipping: 5000,
    last_order_at: null,
    created_at: "2026-01-09T00:00:00.000Z",
    updated_at: "2026-01-09T00:00:00.000Z",
    deposit_balance: 0,
    tag: null,
  },
];

export const ALIAS_TAG_DI_ALIAS = [
  { customer_id: 126, alias: "tagalamat:ITS" },
  { customer_id: 126, alias: "ANIS BRIN" },
  { customer_id: 126, alias: "Anish BRIN" },
  { customer_id: 201, alias: "Gedung FKK ITS Lt 2" },
  { customer_id: 201, alias: "Manajemen Bisnis Ayu" },
  { customer_id: 1969, alias: "tagalamat:ITS" },
  { customer_id: 1969, alias: "Inayati Kasubbag. Regita" },
];

/** Struk untuk customer yang tag-nya hanya ada di alias.

    Nama customer di `sales` sengaja memakai ejaan yang berbeda dari
    `customers` — itu bentuk yang benar-benar terjadi, karena ejaan di
    database keliru sementara struk memakai yang benar. */
export const SALE_TAG_DI_ALIAS = [
  {
    ...SALE_FIXTURE,
    id: 3,
    receipt_no: "SH-20261006-0019",
    customer_name: "Anis BTH",
  },
  {
    ...SALE_FIXTURE,
    id: 4,
    receipt_no: "SH-20261006-0002",
    /* Ejaan di customers adalah "Managemen" (kurang 'e'). */
    customer_name: "Manajemen Bisnis Ayu",
  },
  {
    ...SALE_FIXTURE,
    id: 5,
    receipt_no: "SH-20261006-0003",
    customer_name: "Inayati",
  },
];

/** Struk dengan nama yang tidak ada di `customers`, jadi tag-areanya
    kosong. Untuk menguji tanda "tanpa tag", bukan hanya kasus yang punya
    tag. */
export const SALE_TANPA_TAG = {
  ...SALE_FIXTURE,
  id: 2,
  receipt_no: "SH-20261006-0042",
  customer_name: "Tanpa Tag Customer",
};

/** Nama yang jauh lebih panjang dari lebar kolom mana pun, supaya
    pemotongan benar-benar terjadi dan tooltip punya alasan untuk muncul. */
export const SALE_NAMA_PANJANG =
  "Puri Asri Residential Apartment 3 Blok C Nomor 32 Nenet";

/** Tabel yang diisi spec ini, di atas bawaan fixture. */
export type TabelFixture = Record<string, unknown[]>;

/**
 * Serve every PostgREST request from the fixture above.
 *
 * Writes get the same fixture body back rather than a real mutation. No spec
 * asserts on persisted state — they all assert on what the screen shows
 * straight after the call — so an echo is enough, and nothing here can reach
 * the live database.
 *
 * `tambahan` menambah baris untuk spec yang butuh isi tabel yang kosong.
 * Default-nya kosong supaya spec lain tetap menguji keadaan kosong, yang
 * merupakan majority of the suite's assertions — menambah struk ke
 * bawaan akan mengubah semua angka dashboard yang mereka andalkan.
 */
export async function pakaiSupabasePalsu(
  page: Page,
  tambahan: TabelFixture = {},
): Promise<void> {
  const isi: Record<string, unknown[]> = { ...TABEL, ...tambahan };
  if (tambahan.sales) isi.sale_items = tambahan.sale_items ?? [SALE_BARIS];

  await page.route("**/rest/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const tabel = path.split("/rest/v1/")[1]?.split("/")[0] ?? "";
    const baris = isi[tabel] ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      headers: { "Content-Range": `0-${Math.max(0, baris.length - 1)}/${baris.length}` },
      body: JSON.stringify(baris),
    });
  });

  /* The app syncs the menu from a Google Sheet whenever the tab regains
   * focus, which is every `page.goto`. Returning an empty CSV keeps the
   * suite off the network and stops a real menu from landing on top of the
   * fixture catalog. */
  await page.route("**/gviz/tq**", (route) =>
    route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: "" }),
  );
}