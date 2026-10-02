/* ==========================================================================
   Aturan harga — cerminan server.py (app lama), dipakai frontend & backend.
   Prices are integers in rupiah. No floats anywhere in this file.
   ========================================================================== */

export const MIN_HALF_PRICE = 10_000;

/** Buang semua karakter non-angka, seperti rupiah_number() di server.py. */
export function rupiahNumber(value: unknown): number {
  const digits = String(value ?? "").replace(/[^0-9-]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Pembagian bulat ke atas: 35001 -> 17501 (bukan 17500). */
export function ceilHalf(amount: number): number {
  return Math.floor((amount + 1) / 2);
}

/**
 * Harga varian "Separuh" — setengah dari harga normal, minimal Rp 10.000.
 * Port dari server.py: half_variant_price().
 *
 *   30.000 -> 15.000
 *   18.000 ->  9.000 -> dinaikkan jadi 10.000
 *   10.000 ->  5.000 -> dinaikkan jadi 10.000
 */
export function halfVariantPrice(price: unknown): number {
  const amount = rupiahNumber(price);
  return Math.max(ceilHalf(amount), MIN_HALF_PRICE);
}

/** True kalau harga separuh kena lantai minimum (harga normal terlalu kecil). */
export function halfHitsFloor(price: unknown): boolean {
  return ceilHalf(rupiahNumber(price)) < MIN_HALF_PRICE;
}

/** Berapa rupiah yang dinaikkan oleh aturan minimum. */
export function halfFloorBump(price: unknown): number {
  return Math.max(0, MIN_HALF_PRICE - ceilHalf(rupiahNumber(price)));
}

export const PRICING_TYPES = [
  { id: "fixed", label: "Harga tetap" },
  { id: "unit", label: "Per satuan" },
  { id: "package", label: "Paket" },
  { id: "custom", label: "Custom" },
] as const;

export type PricingType = (typeof PRICING_TYPES)[number]["id"];

export function pricingTypeLabel(value: string): string {
  return PRICING_TYPES.find((t) => t.id === value)?.label ?? "Harga tetap";
}

/** Nama varian dasar yang dikenali sistem (identik dengan app lama). */
export const HALF_VARIANT_NAME = "Separuh";
export const HALF_RECEIPT_LABEL = "Separuh porsi";

export function isHalfVariantName(value: string): boolean {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s-]/g, "");
  return ["1/2", "setengah", "separuh", "halfporsi", "1/2porsi", "setengahporsi", "separuhporsi"].includes(key);
}

export function variantClientId(productClientId: string, kind: "normal" | "half" | "custom"): string {
  return `${productClientId}::${kind}`;
}

/** Varian dasar yang identitasnya dikunci sistem (client_id ::normal/::half/::custom). */
export const BASE_VARIANT_NAMES = ["Normal", HALF_VARIANT_NAME, "Custom"] as const;

export function isBaseVariant(value: string): boolean {
  return (BASE_VARIANT_NAMES as readonly string[]).includes(String(value ?? "").trim());
}
