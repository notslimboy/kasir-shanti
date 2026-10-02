/* ==========================================================================
   Tulis produk & varian ke Supabase.

   Dipakai halaman Kelola Menu. Dua tabel yang disentuh:
     - products        : satu baris per produk (kategori ikut di sini)
     - product_variants: satu baris per varian / cara jual

   Kategori tidak punya tabelnya sendiri — dia cuma kolom `category` di
   products. Jadi "membuat kategori" sebenarnya berarti menyimpan produk
   pertama yang memakai nama kategori itu, dan tab kategorinya muncul karena
   dihitung ulang dari produk yang ada (lihat opsiKategori di pages/menu.tsx).

   products wajib: sku, category, aliases NOT NULL → kosong ditulis sebagai
   string kosong, bukan null (null memicu 23502 dan PATCH ditolak).
   ========================================================================== */

import { SUPABASE_URL, headerRest } from "@/supabase/client";
import type { Product, Variant } from "./menu-seed";

/** Label yang dipakai UI untuk produk tanpa kategori. */
export const TANPA_KATEGORI = "Tanpa Kategori";

/** client_id baru. */
export function buatClientId(): string {
  return crypto.randomUUID();
}

/** Pesan error dari PostgREST. HTTP 400 tanpa body cuma muncul "HTTP 400" —
    penyebab sebenarnya (mis. pelanggaran NOT NULL) ada di `message`. */
async function pesanRelas(r: Response, aksi: string): Promise<string> {
  const body = (await r.text()).slice(0, 160).replace(/\s+/g, " ").trim();
  return body ? `Gagal ${aksi}: HTTP ${r.status} — ${body}` : `Gagal ${aksi}: HTTP ${r.status}`;
}

/** Baris products untuk satu produk UI.
    `category` dan `aliases` selalu string, bahkan kalau kosong. */
function bodyProduk(p: Product, harga: number) {
  const kategori = p.category.trim();
  return {
    name: p.name.trim(),
    price: harga,
    stock: p.stock,
    stock_unlimited: p.stock_unlimited ? 1 : 0,
    sku: p.sku.trim(),
    category: kategori === "" || kategori === TANPA_KATEGORI ? "" : kategori,
    aliases: p.aliases.length > 0 ? JSON.stringify(p.aliases) : "",
    /* Produk yang dibuat di aplikasi tidak boleh ikut terhapus saat Sinkron
       Google Sheet — hapusOrphan hanya menyentuh source="google". */
    source: "manual",
    updated_at: new Date().toISOString(),
  };
}

/** Baris product_variants untuk satu varian UI. Kolom id tidak dikirim —
    itu dibuat database. Teks kosong ditulis sebagai "", bukan null, mengikuti
    baris varian yang sudah ada. */
function bodyVarian(p: Product, v: Variant, urutan: number) {
  return {
    client_id: v.client_id,
    product_client_id: p.client_id,
    name: v.name.trim() === "" ? "Varian" : v.name.trim(),
    pricing_type: v.pricing_type || "fixed",
    price: v.price,
    unit_name: v.unit_name.trim(),
    package_quantity: v.package_quantity || 1,
    package_unit: v.unit_name.trim(),
    receipt_label: v.receipt_label.trim(),
    is_default: v.is_default ? 1 : 0,
    allow_quantity_override: v.allow_quantity_override ? 1 : 0,
    allow_price_override: v.allow_price_override ? 1 : 0,
    /* Stok produk disimpan di baris products; baris varian mengikutinya.
       String kosong (bukan null) mengikuti baris yang sudah ada di database. */
    stock: 0,
    stock_unlimited: 1,
    aliases: "",
    sort_order: urutan,
    active: v.active ? 1 : 0,
    updated_at: new Date().toISOString(),
  };
}

/** Baris varian yang sudah ada untuk produk ini.
    Yang dikembalikan termasuk `id`: penulisan nanti memakai kolom id
    numerik, bukan client_id — client_id memuat "::" yang harus lolos dari
    penulisan filter PostgREST, dan `eq."uuid::normal"` justru tidak cocok. */
async function varianTersimpan(
  productClientId: string,
): Promise<{ id: number; client_id: string }[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/product_variants`);
  url.searchParams.set("select", "id,client_id");
  url.searchParams.set("product_client_id", `eq.${productClientId}`);
  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) throw new Error(await pesanRelas(r, "membaca varian"));
  return (await r.json()) as { id: number; client_id: string }[];
}

/** Perbarui satu varian yang sudah punya baris. Wajib: mengubah harga atau
    nama varian tidak mengubah client_id-nya, jadi tanpa PATCH baris itu
    tetap berisi nilai lama. Ditarget lewat `id` — hasil PostgREST dengan
    `return=minimal` tetap 204 walau nol baris kena, jadi tidak ada cara
    lain untuk tahu filternya salah. */
async function patchVarian(p: Product, v: Variant, urutan: number, id: number): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/product_variants`);
  url.searchParams.set("id", `eq.${id}`);
  const { client_id: _c, product_client_id: _p, ...body } = bodyVarian(p, v, urutan);
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      ...headerRest(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await pesanRelas(r, `menyimpan varian "${v.name}"`));
}

/** Samakan tabel varian dengan isi editor.
    Baris yang masih ada hanya diperbarui (client_id-nya tetap, jadi riwayat
    di sale_items tidak putus); yang dihapus user dihapus, yang baru disisipkan. */
async function tulisVarian(p: Product): Promise<void> {
  const tersimpan = await varianTersimpan(p.client_id);
  const idLewatClientId = new Map(tersimpan.map((r) => [r.client_id, r.id]));
  const dikehendaki = new Set(p.variants.map((v) => v.client_id));
  const dibuang = tersimpan.filter((r) => !dikehendaki.has(r.client_id));

  if (dibuang.length > 0) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/product_variants`);
    url.searchParams.set("id", `in.(${dibuang.map((r) => r.id).join(",")})`);
    const r = await fetch(url, {
      method: "DELETE",
      headers: { ...headerRest(), Prefer: "return=minimal" },
    });
    if (!r.ok) throw new Error(await pesanRelas(r, "menghapus varian"));
  }

  const urutan = (v: Variant) => p.variants.findIndex((x) => x.client_id === v.client_id) + 1;

  await Promise.all(
    p.variants
      .filter((v) => idLewatClientId.has(v.client_id))
      .map((v) => patchVarian(p, v, urutan(v), idLewatClientId.get(v.client_id)!)),
  );

  const baru = p.variants.filter((v) => !idLewatClientId.has(v.client_id));
  if (baru.length === 0) return;

  const url = new URL(`${SUPABASE_URL}/rest/v1/product_variants`);
  const r = await fetch(url, {
    method: "POST",
    headers: {
      ...headerRest(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(baru.map((v) => bodyVarian(p, v, urutan(v)))),
  });
  if (!r.ok) throw new Error(await pesanRelas(r, "menyimpan varian"));
}

/**
 * Simpan produk (baru atau perubahan) beserta variannya.
 *
 * `idBaris` = kolom `id` di tabel products. null berarti produk baru → POST.
 * Harga yang ditulis ke kolom `price` selalu harga varian default, karena di
 * situ kasir membaca harga saat produk dipilih tanpa memilih varian.
 */
export async function simpanProduk(p: Product, idBaris: number | null): Promise<void> {
  const defaultVarian = p.variants.find((v) => v.is_default) ?? p.variants[0];
  const harga = defaultVarian?.price ?? 0;
  const body = bodyProduk(p, harga);

  const headers = {
    ...headerRest(),
    "Content-Type": "application/json",
  };

  if (idBaris !== null) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/products`);
    url.searchParams.set("id", `eq.${idBaris}`);
    const r = await fetch(url, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await pesanRelas(r, `memperbarui "${body.name}"`));
  } else {
    /* products tidak punya kolom created_at. Mengirimnya membalas PGRST204
       dan barisnya tidak jadi tersimpan. */
    const url = new URL(`${SUPABASE_URL}/rest/v1/products`);
    const r = await fetch(url, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ client_id: p.client_id, ...body }),
    });
    if (!r.ok) throw new Error(await pesanRelas(r, `membuat "${body.name}"`));
  }

  await tulisVarian(p);
}