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

const TABEL: Record<string, unknown[]> = {
  customers: CUSTOMER,
  customer_aliases: ALIAS,
  products: PRODUCT,
  product_variants: VARIAN,
  sales: [],
  sale_items: [],
  sale_payments: [],
};

/**
 * Serve every PostgREST request from the fixture above.
 *
 * Writes get the same fixture body back rather than a real mutation. No spec
 * asserts on persisted state — they all assert on what the screen shows
 * straight after the call — so an echo is enough, and nothing here can reach
 * the live database.
 */
export async function pakaiSupabasePalsu(page: Page): Promise<void> {
  await page.route("**/rest/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const tabel = path.split("/rest/v1/")[1]?.split("/")[0] ?? "";
    const baris = TABEL[tabel] ?? [];
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