import type {
  CustomerRow,
  ProductRow,
  ProductVariantRow,
  SaleItemRow,
  SaleRow,
} from "@/supabase/types";
import { VARIAN_BLOB_PREFIX } from "@/supabase/types";
import type { Sale } from "./sale";
import type { Customer } from "./page-data";

/* ==========================================================================
   Mapper Supabase -> bentuk yang dipakai UI.

   Semua fungsi di sini MURNI: tidak ada network, tidak ada Date.now().
   Itu disengaja — aturan bisnis yang salah di sini akan tampil sebagai
   angka salah di layar kasir, jadi harus bisa diuji tanpa internet.

   Tiga hal yang tidak storing di database dan harus dihitung ulang:
     1. ongkir  — tidak ada kolomnya. Sisanya dari total − subtotal + diskon.
     2. status  — tidak ada kolomnya. Diturunkan dari deleted_at + paid_amount.
     3. ongkir default customer — ada kolomnya, tapi 0 berarti belum diisi.
   ========================================================================== */

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Flag 0/1 dari Postgres Sometimes datang sebagai boolean. */
export const flag = (v: unknown): boolean => v === true || v === 1 || v === "1";

/* -------------------------------------------------------------------------
   Tanggal & zona waktu

   completed_at disimpan sebagai UTC dengan offset, misalnya
   "2026-09-29T07:01:34.552+00:00". Kalau string itu dipakai apa adanya,
   jam 07:01 tampil di layar kasir padahal transaksinya jam 14:01 WIB.

   App lama memakai new Date(...).toLocaleString("id-ID"), yang memakai zona
   waktu mesin kasir. Itu yang ditiru di sini: konversi ke waktu lokal dulu.
   ---------------------------------------------------------------------- */

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/* Bentuk tiga huruf, untuk tempat yang lebarnya sempit. "6 Okt 09:49"
   muat di kartu struk pada layar 320px; "6 Oktober 2026, 09:49" tidak
   muat dan justru terpotong jadi "6 Okt...", sehingga tanggalnya
   hilang justru di tempat yang paling sempit. */
const BULAN_SINGKAT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

function keWaktuLokal(iso: string): Date | null {
  const t = new Date(String(iso));
  return Number.isNaN(t.getTime()) ? null : t;
}

/** "2026-09-29" versi lokal. Dipakai untuk mengelompokkan per hari dan
    untuk memotong rentang — hari bisnis dihitung menurut jam kasir. */
export function tanggalISODari(row: SaleRow): string {
  const l = keWaktuLokal(row.completed_at);
  if (l) {
    return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}-${String(l.getDate()).padStart(2, "0")}`;
  }
  return String(row.completed_at).slice(0, 10);
}

/** "29 September 2026, 14:01" */
export function labelWaktuLokal(iso: string): string {
  const l = keWaktuLokal(iso);
  if (!l) return String(iso);
  const jam = String(l.getHours()).padStart(2, "0");
  const menit = String(l.getMinutes()).padStart(2, "0");
  return `${l.getDate()} ${BULAN[l.getMonth()]} ${l.getFullYear()}, ${jam}:${menit}`;
}

/** "6 Okt 09:49" — untuk kartu di layar sempit.
    Tahun sengaja dibuang: layar ini sudah menunjukkan satu rentang
    tanggal, jadi tahun tidak menambah informasi, sedangkan nama bulan
    penuh memakan lebar yang justru dibutuhkan jam. */
export function labelWaktuRingkas(iso: string): string {
  const l = keWaktuLokal(iso);
  if (!l) return String(iso);
  const jam = String(l.getHours()).padStart(2, "0");
  const menit = String(l.getMinutes()).padStart(2, "0");
  return `${l.getDate()} ${BULAN_SINGKAT[l.getMonth()]} ${jam}:${menit}`;
}

/** "29 September 2026" */
export function labelTanggalPendek(iso: string): string {
  const l = keWaktuLokal(iso);
  if (!l) return String(iso).slice(0, 10);
  return `${l.getDate()} ${BULAN[l.getMonth()]} ${l.getFullYear()}`;
}

/* -------------------------------------------------------------------------
   Ongkir — tidak ada kolomnya di tabel sales
   ---------------------------------------------------------------------- */

/** Ongkir = selisih total dengan subtotal.
    Kolom `discount` di tabel sales BUKAN diskon harga: versi lama menulis
    ongkir ke sana (`discount: totals.shipping`) lalu membacanya lewat
    getSaleShipping (`sale.shipping || sale.discount`). Dicek ke 1.000 struk
    nyata: `discount == total − subtotal` tanpa kecuali, jadi menjadikannya
    pembawa ongkir kedua akan menghitung ongkir dua kali (10.000 jadi
    20.000) dan=onkir di dashboard melonjak. Tax 0 di semua struk lama,
    tapi tetap ikut dihitung supaya struk berpajak tidak salah baca. */
export function ongkirDari(row: Pick<SaleRow, "total" | "subtotal" | "discount" | "tax">): number {
  const sisa = n(row.total) - n(row.subtotal) + n(row.tax);
  if (sisa > 0) return sisa;
  /* Fallback: struk tanpa ongkir tapi dengan diskon asli (format lain). */
  const diskon = n(row.discount);
  return diskon > 0 ? diskon : 0;
}

/* -------------------------------------------------------------------------
   Status — tidak ada kolomnya di tabel sales
   ---------------------------------------------------------------------- */

export type StatusStruk = "lunas" | "belum" | "terhapus";

/** Dihapus menang atas apa pun. Lalu lunas kalau sudah dibayar penuh. */
export function statusDari(
  row: Pick<SaleRow, "deleted_at" | "paid_amount" | "total">,
): StatusStruk {
  if (row.deleted_at) return "terhapus";
  return n(row.paid_amount) >= n(row.total) && n(row.total) > 0 ? "lunas" : "belum";
}

/* -------------------------------------------------------------------------
   Baris item
   ---------------------------------------------------------------------- */

/** Nama yang dicetak, mengikuti getReceiptItemDisplayName() di app lama:
    varian selain "Normal" ikut disebut supaya dapur tahu "Separuh". */
export function namaItemDari(row: Pick<SaleItemRow, "menu_name" | "name" | "variant_name" | "receipt_label">): string {
  const menu = String(row.menu_name || row.name || "Item").trim();
  const label = String(row.receipt_label ?? "").trim();
  const varian = String(row.variant_name ?? "").trim();
  if (label) return `${menu} (${label})`;
  if (varian && varian.toLowerCase() !== "normal") return `${menu} (${varian})`;
  return menu;
}

export function mapItem(row: SaleItemRow) {
  return {
    /* Dibawa naik supaya form Ubah Data bisa menulis balik per baris.
       Dicocokkan lewat nama + varian tidak aman: satu menu bisa muncul dua
       kali dengan varian berbeda, dan begitu nama diedit keduanya bisa sama
       persis — lalu PATCH-nya menimpa baris yang salah. */
    id: row.id,
    name: String(row.menu_name || row.name || "Item").trim(),
    variant: String(row.variant_name ?? "").trim(),
    qty: n(row.quantity),
    price: n(row.price),
    note: String(row.note ?? ""),
  };
}

/* -------------------------------------------------------------------------
   Struk
   ---------------------------------------------------------------------- */

export function mapStruk(row: SaleRow, items: SaleItemRow[] = []): Sale {
  const lines = items.map(mapItem);
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    customer: String(row.customer_name || "").trim(),
    completedOn: tanggalISODari(row),
    completedIso: row.completed_at,
    completedAt: labelWaktuLokal(row.completed_at),
    completedAtShort: labelWaktuRingkas(row.completed_at),
    total: n(row.total),
    payment: String(row.payment || "Lainnya"),
    itemCount: lines.reduce((a, l) => a + l.qty, 0),
    status: statusDari(row),
    address: String(row.customer_address ?? "").trim() || undefined,
    /* `send_note` diambil dari server (live.ts:105) tapi sebelumnya dibuang
       di sini, lalu struk-drawer mengisinya dengan string kosong. Akibatnya
       "CATATAN KIRIM" yang ada di struk asli hilang begitu di-cetak ulang. */
    sendNote: String(row.send_note ?? "").trim() || undefined,
    courier: undefined, // tidak ada kolomnya di tabel sales
    ongkir: ongkirDari(row),
    diskon: n(row.discount),
    lines,
  };
}

/** Ringkasan per customer untuk halaman Data Customer. */
export function rekapPerCustomer(sales: SaleRow[]) {
  const map = new Map<string, { orderCount: number; total: number; last: string }>();
  for (const s of sales) {
    if (s.deleted_at) continue;
    const nama = String(s.customer_name || "").trim();
    if (!nama) continue;
    const cur = map.get(nama) ?? { orderCount: 0, total: 0, last: "" };
    cur.orderCount += 1;
    cur.total += n(s.total);
    if (String(s.completed_at) > cur.last) cur.last = String(s.completed_at);
    map.set(nama, cur);
  }
  return map;
}

export function mapCustomer(
  row: CustomerRow,
  rekap?: { orderCount: number; total: number; last: string },
): Customer {
  const lastOrder = rekap?.last
    ? labelTanggalPendek(rekap.last)
    : row.last_order_at
      ? labelTanggalPendek(row.last_order_at)
      : "—";
  return {
    // id dibuat dari kolom id numerik supaya unik & stabil antar muat.
    id: `c${row.id}`,
    name: row.name,
    /* customers tidak punya kolom alamat maupun catatan. Alamat muncul di
       sales.customer_address dan sering kosong, jadi di sini dikosongkan
       daripada mengarang. */
    address: "",
    tag: row.tag && row.tag.trim() ? row.tag.trim() : null,
    orderCount: rekap?.orderCount ?? 0,
    total: rekap?.total ?? 0,
    lastOrder,
    deposit: n(row.deposit_balance),
    ongkir: n(row.default_shipping),
    note: "",
  };
}

/* -------------------------------------------------------------------------
   Produk + varian
   ---------------------------------------------------------------------- */

export type VarianProduk = {
  client_id: string;
  name: string;
  pricing_type: string;
  price: number;
  unit_name: string;
  package_quantity: number;
  receipt_label: string;
  is_default: boolean;
  active: boolean;
};

/** Varian yang tersimpan di kolom aliases produk (hasil migrasi lama).
    Formatnya: prefix + JSON yang di-URL-encode. */
export function varianDariAlias(aliases: string | null): VarianProduk[] {
  if (!aliases || !aliases.startsWith(VARIAN_BLOB_PREFIX)) return [];
  try {
    const json = decodeURIComponent(aliases.slice(VARIAN_BLOB_PREFIX.length));
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((v) => ({
      client_id: String(v.client_id ?? ""),
      name: String(v.name ?? ""),
      pricing_type: String(v.pricing_type ?? "fixed"),
      price: n(v.price),
      unit_name: String(v.unit_name ?? ""),
      package_quantity: n(v.package_quantity) || 1,
      receipt_label: String(v.receipt_label ?? ""),
      is_default: flag(v.is_default),
      active: flag(v.active ?? 1),
    }));
  } catch {
    // Alias rusak tidak boleh menjatuhkan seluruh halaman menu.
    return [];
  }
}

export function mapVarian(row: ProductVariantRow): VarianProduk {
  return {
    client_id: row.client_id,
    name: row.name,
    pricing_type: row.pricing_type || "fixed",
    price: n(row.price),
    unit_name: row.unit_name ?? "",
    package_quantity: n(row.package_quantity) || 1,
    receipt_label: row.receipt_label ?? "",
    is_default: flag(row.is_default),
    active: flag(row.active),
  };
}

/** Varian "Normal" sintetis untuk produk yang belum punya baris varian.
    Tanpa ini, produk tidak punya harga default sama sekali dan tidak bisa
    dipilih di Kasir. */
export function varianNormal(clientId: string, price: number): VarianProduk {
  return {
    client_id: `${clientId}::normal`,
    name: "Normal",
    pricing_type: "fixed",
    price: n(price),
    unit_name: "porsi",
    package_quantity: 1,
    receipt_label: "",
    is_default: true,
    active: true,
  };
}

/** Sumber kebenaran untuk varian sebuah produk: tabel dulu, blob alias
    sebagai cadangan, lalu varian Normal sintetis sebagai jaring pengaman. */
export function varianUntukProduk(
  product: Pick<ProductRow, "client_id" | "price" | "aliases">,
  rows: ProductVariantRow[],
): VarianProduk[] {
  const dariTabel = rows
    .filter((r) => r.product_client_id === product.client_id)
    .map(mapVarian)
    .sort((a, b) => Number(a.is_default ? 0 : 1) - Number(b.is_default ? 0 : 1));

  if (dariTabel.length > 0) return dariTabel;

  const dariBlob = varianDariAlias(product.aliases);
  if (dariBlob.length > 0) return dariBlob;

  return [varianNormal(product.client_id, product.price)];
}

/** Kategori kosong sangat sering (374 dari 1000 produk pertama). UI tidak
    boleh menampilkan string kosong sebagai pilihan. */
export function kategoriProduk(category: string | null | undefined): string {
  const c = String(category ?? "").trim();
  return c || "Tanpa Kategori";
}
