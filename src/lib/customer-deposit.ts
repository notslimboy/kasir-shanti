/* ==========================================================================
   Resolusi customer untuk pencatatan piutang.

   Kenapa modul ini ada: `sales.customer_name` menyimpan nama BEBAS — kasir
   bisa mengetik "Memet 22" sementara baris resminya di `customers` bernama
   berbeda, atau nama itu cuma muncul sebagai alias. Modul piutang-tulis
   mencari customer dengan `name=eq.<nama>` persis; kalau tidak ketemu, ia
   membuat baris customer baru.

   Two lookups fix the common case without changing any other behaviour:
   exact name first, then the alias table — which exists precisely to record
   "the same person, written differently". Either way the danger is the
   same: a payment for someone who already exists splits their deposit
   across two rows, and every new row is one more duplicate for whoever
   cleans the customer table later.

   A customer that matches neither is genuinely new, and creating it stays
   allowed. Blocking there would mean a cashier cannot record a payment for
   someone who has never ordered before, which is worse.
   ========================================================================== */

/** Customer secukupnya untuk menulis deposit. */
export type CustomerDeposit = { id: number; deposit_balance: number; name: string };

/** Bentuk `customers.name` setelah dinormalisasi: huruf kecil, tanpa tanda
 *  baca dan tanpa spasi. Sama dengan `kunci()` di
 *  scripts/rapikan_customer_duplikat.py dan `normalize_key` di script parser
 *  — supaya "Mutiara C3 / 367" di struk baris "Mutiara C3/367". */
export function kunciNama(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Alias yang tidak mungkin jadi customer sungguhan. */
/** Alias milik satu customer, dikecualikan yang hanya mengulang namanya
 *  sendiri — alias seperti itu tidak pernah menyesatkan. */
function aliasPakai(entries: string[], nama: string): string[] {
  return entries
    .map((a) => String(a ?? "").trim())
    .filter((a) => a && kunciNama(a) !== kunciNama(nama));
}

/**
 * Cari customer yang harus menerima deposit.
 *
 * Urutannya penting dan sengaja tidak diubah:
 *   1. nama persis   — tidak perlu tebakan, ini yang dipakai kasir
 *   2. nama ternormalisasi — beda spasi/tanda baca saja
 *   3. alias         — "Bhas 7/17" -> "Bhaskara 7/17"
 *   4. alias ternormalisasi
 *
 * Kalau ada lebih dari satu kandidat pada tahap mana pun, yang terkecil
 * `id`-nya dipilih supaya hasilnya stabil — bukan "yang ketemu lebih dulu",
 * yang bisa berubah tiap reload.
 */
export function pilihCustomer(
  nama: string,
  customers: CustomerDeposit[],
  aliasEntries: { customer_id: number; alias: string }[],
): CustomerDeposit | null {
  const cari = kunciNama(nama);
  if (!cari) return null;

  const byId = new Map(customers.map((c) => [c.id, c]));
  const kecil = (a: CustomerDeposit, b: CustomerDeposit) => a.id - b.id;
  const unik = (list: CustomerDeposit[]) =>
    list.length === 0 ? null : [...list].sort(kecil)[0];

  const aliasCustomer = new Map<number, string[]>();
  for (const a of aliasEntries) {
    const list = aliasCustomer.get(a.customer_id) ?? [];
    list.push(a.alias);
    aliasCustomer.set(a.customer_id, list);
  }
  const lewatAlias = (kunci: string): CustomerDeposit[] =>
    [...aliasCustomer.entries()]
      .filter(([, list]) => list.some((x) => kunciNama(x) === kunci))
      .map(([id]) => byId.get(id))
      .filter((c): c is CustomerDeposit => c !== undefined);

  return (
    unik(customers.filter((c) => String(c.name ?? "").trim() === String(nama).trim())) ??
    unik(customers.filter((c) => kunciNama(c.name) === cari)) ??
    unik(lewatAlias(cari)) ??
    unik(
      customers.filter((c) =>
        aliasPakai(aliasCustomer.get(c.id) ?? [], nama).some((a) => kunciNama(a) === cari),
      ),
    )
  );
}

/**
 * `paid_amount` setelah pembatalan dibatalkan.
 *
 * Pembatalan menghapus seluruh riwayat pembayaran struk itu, jadi sisa
 * yang harus tersisa adalah pembayaran yang TIDAK ikut terhapus. Versi lama
 * menulis `paid_amount: 0` — sehingga struk yang dibayar separuh (Rp 50.000
 * dari Rp 100.000) kehilangan catatan Rp 50.000 itu begitu pembatalannya
 * ditekan, dan struk yang sama tidak pernah bisa direkonstruksi.
 */
export function paidSetelahBatal<T extends { amount: number }>(
  payments: readonly T[],
  idDihapus: ReadonlySet<number>,
  punyaId: (p: T) => number,
): number {
  let total = 0;
  for (const p of payments) {
    if (idDihapus.has(punyaId(p))) continue;
    const v = Number(p.amount ?? 0);
    if (Number.isFinite(v) && v > 0) total += v;
  }
  return total;
}