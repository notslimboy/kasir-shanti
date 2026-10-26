/* ==========================================================================
   Cache klien untuk endpoint itsfood (module-level, in-memory).

   Server sudah punya cache SWR sendiri; lapisan ini mencegah request
   keluar SAMA SEKALI untuk navigasi bolak-balik antar halaman (kalender →
   payment → kalender) dalam jendela TTL — karena tiap pindah route
   meng-unmount page component dan memusnahkan state-nya.

   Request yang bersamaan untuk kunci yang sama di-dedup (satu fetch,
   semua penunggu dapat hasil yang sama). `paksa: true` (tombol
   "Muat ulang") melewati umur cache dan menimpa isinya.
   ========================================================================== */

const TTL_BAWAAN = 60_000;

interface EntriKlien {
  data?: unknown;
  at: number;
  promise?: Promise<unknown>;
}

const cache = new Map<string, EntriKlien>();

export async function dgnCacheKlien<T>(
  kunci: string,
  fetcher: () => Promise<T>,
  opsi: { ttl?: number; paksa?: boolean } = {},
): Promise<T> {
  const ttl = opsi.ttl ?? TTL_BAWAAN;
  const entri = cache.get(kunci) ?? { at: 0 };
  const umur = entri.at ? Date.now() - entri.at : Infinity;

  if (!opsi.paksa && entri.data !== undefined && umur < ttl) {
    return entri.data as T;
  }
  // Dedup: request yang sedang berjalan dipakai bersama — kecuali paksa
  // (tombol muat ulang memang menuntut data baru).
  if (!opsi.paksa && entri.promise) return (await entri.promise) as T;

  const promise = fetcher();
  cache.set(kunci, { ...entri, promise });
  try {
    const data = await promise;
    cache.set(kunci, { data, at: Date.now() });
    return data;
  } catch (e) {
    // Fetch gagal: entri lama (kalau ada) tetap dipakai lagi kalau ada,
    // promise-nya dibuang supaya percobaan berikutnya mencoba fetch.
    cache.set(kunci, { data: entri.data, at: entri.at });
    throw e;
  }
}

/** Kosongkan cache klien untuk kunci berprefiks tertentu — dipanggil
    setelah mutasi (terima order / buat tagihan) yang mengubah data di
    portal, supaya tampilan berikutnya tidak menelan data basi. */
export function kosongkanCacheKlien(prefiks: string[]): void {
  for (const k of [...cache.keys()]) {
    if (prefiks.some((p) => k.startsWith(p))) cache.delete(k);
  }
}
