/* ==========================================================================
   Bentuk produk untuk UI.

   Satu baris products = satu produk. Baris berulang di database memang
   dipakai untuk varian, jadi tidak boleh digabung di sini — hasil query
   ditampilkan apa adanya.

   Varian diambil dari product_variants; kalau produk belum punya baris
   varian, synthesized "Normal" supaya tetap punya harga default (lihat
   varianUntukProduk di lib/live-mappers.ts).
   ========================================================================== */

export type Variant = {
  client_id: string;
  name: string;
  pricing_type: string;
  price: number;
  unit_name: string;
  package_quantity: number;
  receipt_label: string;
  is_default: boolean;
  allow_quantity_override: boolean;
  allow_price_override: boolean;
  active: boolean;
};

export type Product = {
  client_id: string;
  name: string;
  sku: string;
  category: string;
  /** Kata kunci untuk parser chat WhatsApp. */
  aliases: string[];
  stock: number;
  stock_unlimited: boolean;
  variants: Variant[];
};
