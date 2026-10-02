// Tipe yang cermin schema Supabase nyata (probe ulang 30 Sep 2026).
//
// Catatan penting soal flag boolean: kolom seperti is_default,
// stock_unlimited, dan active storing angka 0/1, bukan true/false.
// Kalau diketik boolean, hasil query akan salah tipe diam-diam.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface SaleRow {
  id: number;
  receipt_no: string;
  completed_at: string;
  store_name: string;
  payment: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  customer_name: string;
  customer_address: string;
  order_note: string;
  due_text: string;
  chat_date: string;
  /** null = struk masih hidup. Terisi = struk dihapus. */
  deleted_at: string | null;
  stock_restored_on_delete: number | boolean;
  paid_amount: number;
  created_at: string;
  queue_no: number | null;
  queue_date: string;
  send_note: string;
}

export interface SaleItemRow {
  id: number;
  sale_id: number;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  line_total: number;
  note: string;
  product_client_id: string;
  variant_client_id: string;
  menu_name: string;
  variant_name: string;
  unit_name: string;
  unit_quantity: string | number | null;
  pricing_type: string;
  receipt_label: string;
}

export interface SalePaymentRow {
  id: number;
  sale_id: number;
  amount: number;
  payment_date: string;
  note: string;
  created_at: string;
}

export interface ProductRow {
  id: number;
  client_id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
  stock_unlimited: number | boolean;
  category: string;
  /** Slice JSON alias. Some produk lama masih menaruh varian di sini
      dengan awalan __kasir_product_variants_v1: — lihat aliasToVarian(). */
  aliases: string | null;
  source: string;
  updated_at: string;
}

export interface ProductVariantRow {
  id: number;
  client_id: string;
  product_client_id: string;
  name: string;
  pricing_type: string;
  price: number;
  unit_name: string | null;
  package_quantity: string | number | null;
  package_unit: string | null;
  receipt_label: string | null;
  is_default: number | boolean;
  allow_quantity_override: number | boolean;
  allow_price_override: number | boolean;
  stock: number | null;
  stock_unlimited: number | boolean;
  aliases: string | null;
  sort_order: number;
  active: number | boolean;
  updated_at: string;
}

export interface CustomerRow {
  id: number;
  name: string;
  default_shipping: number;
  last_order_at: string | null;
  created_at: string;
  updated_at: string;
  deposit_balance: number;
  /** Ini AREA / franchise (ITS, GOJEK, Sutorejo, Bhaskara), bukan
      kategori Rumah/Kantor/Kampus. Jangan dipaksa jadi tipe tetap. */
  tag: string | null;
}

export interface CustomerAliasRow {
  id: number;
  customer_id: number;
  alias: string;
  alias_key: string;
  created_at: string;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
};

export interface Database {
  public: {
    Tables: {
      sales: Table<
        SaleRow,
        Partial<SaleRow> & { receipt_no: string; completed_at: string; store_name: string; payment: string; subtotal: number; total: number; created_at: string }
      >;
      sale_items: Table<SaleItemRow>;
      sale_payments: Table<SalePaymentRow>;
      products: Table<ProductRow>;
      product_variants: Table<ProductVariantRow>;
      customers: Table<CustomerRow>;
      customer_aliases: Table<CustomerAliasRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

/** PENTING: kolom aliases produk bisa berisi JSON berawalan ini (hasil
    migrasi lama). Yang baru sudah pindah ke tabel product_variants, tapi
    produk lama masih menyimpan salinannya di sini. */
export const VARIAN_BLOB_PREFIX = "__kasir_product_variants_v1:";
