/* ==========================================================================
   Cache klien untuk endpoint itsfood.

   Dua lapis:
   1. memori (module-level) — instan untuk pindah halaman tanpa reload
   2. sessionStorage — bertahan saat halaman di-reload penuh / dibuka dari
      URL langsung, jadi data yang sudah pernah diambil langsung tampil.

   Tanpa lapis kedua, setiap refresh memaksa scrape ulang ke portal dan
   user melihat "memuat" terus meski datanya baru saja diambil.

   Request bersamaan untuk kunci yang sama di-dedup. `paksa: true` (tombol
   "Muat ulang") melewati kedua lapis dan menimpa isinya.
   ========================================================================== */

const TTL_BAWAAN = 5 * 60_000;
const PREFIKS_SIMPAN = "itsfood:v2:"; /* v2: bentuk cache dinormalisasi (daftar mentah, tanpa Set/Map) */

interface EntriKlien {
  data?: unknown;
  at: number;
  promise?: Promise<unknown>;
}

const cache = new Map<string, EntriKlien>();

function bacaSimpanan(kunci: string): EntriKlien | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIKS_SIMPAN + kunci);
    if (!raw) return undefined;
    const isi = JSON.parse(raw) as { data: unknown; at: number };
    if (Date.now() - isi.at > TTL_BAWAAN) {
      sessionStorage.removeItem(PREFIKS_SIMPAN + kunci);
      return undefined;
    }
    return isi;
  } catch {
    return undefined;
  }
}

function tulisSimpanan(kunci: string, entri: EntriKlien): void {
  try {
    if (entri.data === undefined) sessionStorage.removeItem(PREFIKS_SIMPAN + kunci);
    else
      sessionStorage.setItem(
        PREFIKS_SIMPAN + kunci,
        JSON.stringify({ data: entri.data, at: entri.at }),
      );
  } catch {
    /* kuota penuh / mode privat — cache memori tetap jalan */
  }
}

/** Baca cache secara SINKRON — dipakai sebagai nilai awal state halaman,
    supaya pindah menu/reload langsung menampilkan data yang sudah ada
    tanpa render "memuat" lebih dulu. */
export function bacaCacheKlien<T>(kunci: string, ttl = TTL_BAWAAN): T | undefined {
  const entri = cache.get(kunci) ?? bacaSimpanan(kunci);
  if (!entri || entri.data === undefined) return undefined;
  if (Date.now() - entri.at >= ttl) return undefined;
  cache.set(kunci, entri);
  return entri.data as T;
}

export async function dgnCacheKlien<T>(
  kunci: string,
  fetcher: () => Promise<T>,
  opsi: { ttl?: number; paksa?: boolean } = {},
): Promise<T> {
  const ttl = opsi.ttl ?? TTL_BAWAAN;
  const entri = cache.get(kunci) ?? bacaSimpanan(kunci) ?? { at: 0 };
  const umur = entri.at ? Date.now() - entri.at : Infinity;

  if (!opsi.paksa && entri.data !== undefined && umur < ttl) {
    cache.set(kunci, entri);
    return entri.data as T;
  }
  if (!opsi.paksa && entri.promise) return (await entri.promise) as T;

  const promise = fetcher();
  cache.set(kunci, { ...entri, promise });
  try {
    const data = await promise;
    const baru = { data, at: Date.now() };
    cache.set(kunci, baru);
    tulisSimpanan(kunci, baru);
    return data;
  } catch (e) {
    cache.set(kunci, { data: entri.data, at: entri.at });
    throw e;
  }
}

/** Kosongkan cache (memori + simpanan) untuk kunci berprefiks tertentu —
    dipanggil setelah mutasi (terima order / buat tagihan) supaya tampilan
    berikutnya tidak menelan data basi. */
export function kosongkanCacheKlien(prefiks: string[]): void {
  for (const k of [...cache.keys()]) {
    if (prefiks.some((p) => k.startsWith(p))) cache.delete(k);
  }
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (!k.startsWith(PREFIKS_SIMPAN)) continue;
      const asli = k.slice(PREFIKS_SIMPAN.length);
      if (prefiks.some((p) => asli.startsWith(p))) sessionStorage.removeItem(k);
    }
  } catch {
    /* mode privat — tidak ada yang bisa dibersihkan */
  }
}
