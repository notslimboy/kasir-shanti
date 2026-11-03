/* ==========================================================================
   Mencari saldo deposit customer dengan pencocokan nama fuzzy.

   Dipisah dari customer-deposit.ts karena modul itu fokus ke piutang
   (PATCH deposit & ledger), sementara ini hanya pencarian — dipakai
   Kasir dan Import Pesanan.
   ========================================================================== */

import { kunciNama } from "./customer-deposit";

/**
 * Ekstrak id numerik dari string id Customer ("c1902" → 1902).
 * `customers` dari data-source punya id berbentuk "c{number}";
 * `customerAlias` memakai id numerik langsung.
 */
function idNumerik(c: { id?: string }): number {
  const n = Number(c.id?.replace(/^c/, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Saldo deposit customer terbaik yang cocok dengan `nama`.
 *
 * `customers` — dari UI, tiap elemen minimal punya `name` dan `deposit`.
 *                Kalau ada `id` dalam format "c{number}", dipakai untuk
 *                mencocokkan alias.
 * `alias` — `customer_id` = id numerik dari tabel `customers`, `alias` = ejaan lain.
 *
 * Urutan pencocokan (berhenti di yang pertama cocok):
 *   1. nama persis case/space-insensitive
 *   2. alias persis case/space-insensitive
 *   3. nama yang memuat nama customer (longest match dulu)
 *   4. alias yang memuat
 *
 * Kalau tidak ada yang cocok → 0.
 */
export function saldoDepositUntuk(
  nama: string,
  customers: readonly ({ name: string; deposit: number } & { id?: string })[],
  alias: readonly { customer_id: number; alias: string }[],
): number {
  const cari = kunciNama(nama);
  if (!cari) return 0;

  /* (1) nama persis case/space-insensitive */
  const persis = customers.find((c) => kunciNama(c.name) === cari);
  if (persis) return persis.deposit;

  /* (2) alias persis — cari customer yang punya alias = input */
  for (const a of alias) {
    if (kunciNama(a.alias) === cari) {
      const c = customers.find((x) => a.customer_id === idNumerik(x));
      if (c) return c.deposit;
    }
  }

  /* (3) nama yang memuat nama customer — longest name dulu */
  const urutNama = [...customers].sort((a, b) => b.name.length - a.name.length);
  for (const c of urutNama) {
    const cKunci = kunciNama(c.name);
    if (cKunci && cari.includes(cKunci)) return c.deposit;
  }

  /* (4) alias yang memuat */
  const urutAlias = [...alias].sort((a, b) => b.alias.length - a.alias.length);
  for (const a of urutAlias) {
    const aKunci = kunciNama(a.alias);
    if (aKunci && cari.includes(aKunci)) {
      const c = customers.find((x) => a.customer_id === idNumerik(x));
      if (c) return c.deposit;
    }
  }

  return 0;
}