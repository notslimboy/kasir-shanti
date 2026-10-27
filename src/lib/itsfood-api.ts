/* ==========================================================================
   Cache klien untuk endpoint itsfood.

   Tiga lapis:
   1. memori (module-level)       — instan antar-halaman tanpa reload
   2. localStorage (`itsfood:v3:`)— TETAP ADA setelah browser ditutup.
      Data yang sudah pernah diambil (mis. bulan Oktober) langsung tampil
      dari sekolah besok/kapan pun, tanpa menunggu scrape ke portal.
   3. segarkanKlien (silent SWR)  — setelah data tersimpan tampil, halaman
      menarik versi terbaru DIAM-DIAM dan menimpa cache. Tidak ada spinner,
      tidak ada toast; muat yang terlihat hanya terjadi kalau memang belum
      ada apa-apa di lokal, atau saat tombol "Muat ulang" ditekan.

   Kenapa localStorage, bukan sessionStorage: sessionStorage mati tiap tab
   ditutup — persis keluhan "ganti menu / buka lagi, memuat mulu".
   Kuota aman karena isinya dibatasi pangkasSimpanan() (detail 10 hari,
   maksimum 8 bulan order).

   Request bersamaan untuk kunci yang sama di-dedup. `paksa: true` (tombol
   "Muat ulang" / setelah mutasi) melewati kedua lapis dan menimpa isinya.
   ========================================================================== */

const PREFIKS_SIMPAN = "itsfood:v3:"; /* v3: localStorage + bentuk kanonik (daftar mentah + rekap) */

interface EntriKlien {
  data?: unknown;
  at: number;
  promise?: Promise<unknown>;
}

const cache = new Map<string, EntriKlien>();

/* ------------------------------------------------------------------ */
/* Lapis 2 — localStorage (selalu dipangkas try/catch: kuota penuh,    */
/* mode privat, atau storage dimatikan tidak boleh jatuhkan halaman)   */
/* ------------------------------------------------------------------ */

function bacaSimpanan(kunci: string): EntriKlien | undefined {
  try {
    const raw = localStorage.getItem(PREFIKS_SIMPAN + kunci);
    if (!raw) return undefined;
    const isi = JSON.parse(raw) as { data: unknown; at: number };
    /* Bentuk tak valid (JSON rusak / struktur lama) = tidak ada; kuncinya
       dibuang supaya tidak dibaca terus. TANPA pemeriksaan umur: data lama
       tetap tampil, kesegaran jadi tugas segarkanKlien. */
    if (typeof isi?.at !== "number" || isi.data === undefined) {
      localStorage.removeItem(PREFIKS_SIMPAN + kunci);
      return undefined;
    }
    return isi;
  } catch {
    /* JSON.txt rusak → kuncinya juga dibuang */
    try {
      localStorage.removeItem(PREFIKS_SIMPAN + kunci);
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

function tulisSimpanan(kunci: string, entri: EntriKlien): void {
  try {
    if (entri.data === undefined) localStorage.removeItem(PREFIKS_SIMPAN + kunci);
    else
      localStorage.setItem(
        PREFIKS_SIMPAN + kunci,
        JSON.stringify({ data: entri.data, at: entri.at }),
      );
  } catch {
    /* kuota penuh / mode privat — lapis memori tetap jalan */
  }
}

/* ------------------------------------------------------------------ */
/* Mesin fetch bersama: jalankan fetcher, tulis kedua lapis, dan       */
/* kembalikan entri lama kalau fetch gagal (screen tidak boleh kosong) */
/* ------------------------------------------------------------------ */

async function denganTulis<T>(
  kunci: string,
  entriLama: EntriKlien | undefined,
  promise: Promise<T>,
): Promise<T> {
  cache.set(kunci, { ...(entriLama ?? { at: 0 }), promise });
  try {
    const data = await promise;
    const baru = { data, at: Date.now() };
    cache.set(kunci, baru);
    tulisSimpanan(kunci, baru);
    return data;
  } catch (e) {
    cache.set(kunci, { data: entriLama?.data, at: entriLama?.at ?? 0 });
    throw e;
  }
}

/** Baca cache secara SINKRON — apa pun umurnya. Dipakai sebagai nilai awal
    state halaman: data dari kemarin dibuka hari ini tetap tampil seketika,
    lalu diperbarui via segarkanKlien. */
export function bacaCacheKlien<T>(kunci: string): T | undefined {
  const entri = cache.get(kunci) ?? bacaSimpanan(kunci);
  if (!entri || entri.data === undefined) return undefined;
  cache.set(kunci, entri);
  return entri.data as T;
}

/** Ambil data: cache yang ada langsung dipakai TANPA request. Request hanya
    kalau lokal benar-benar kosong, atau `paksa: true` (tombol Muat ulang /
    jalur mutasi) yang menimpa cache. */
export async function dgnCacheKlien<T>(
  kunci: string,
  fetcher: () => Promise<T>,
  opsi: { paksa?: boolean } = {},
): Promise<T> {
  const entri = cache.get(kunci) ?? bacaSimpanan(kunci);
  if (!opsi.paksa) {
    if (entri?.data !== undefined) {
      cache.set(kunci, entri);
      return entri.data as T;
    }
    if (entri?.promise) return (await entri.promise) as T;
  }
  return denganTulis(kunci, entri, fetcher());
}

/** Segarkan diam-diam (stale-while-revalidate): MENJALANKAN fetch walau data
    sudah ada, lalu menimpa cache dengan hasil terbaru. Halaman memanggil ini
    setelah menampilkan data tersimpan; kalau gagal, data lama tetap dipakai
    (caller biasanya .catch(() => {}) supaya tidak muncul galat palsu). */
export async function segarkanKlien<T>(
  kunci: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const entri = cache.get(kunci);
  /* Request yang sedang berjalan dipakai bersama — dua halaman yang men-
     segarkan kunci sama tidak jadi dua GET ke portal. */
  if (entri?.promise) return entri.promise as Promise<T>;
  return denganTulis(kunci, entri, fetcher());
}

/** Kosongkan kedua lapis untuk kunci berprefiks tertentu — dipanggil setelah
    mutasi (terima order / buat tagihan) supaya pembacaan berikutnya tidak
    menelan data basi dari localStorage. */
export function kosongkanCacheKlien(prefiks: string[]): void {
  for (const k of [...cache.keys()]) {
    if (prefiks.some((p) => k.startsWith(p))) cache.delete(k);
  }
  try {
    const semua: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) semua.push(k);
    }
    for (const k of semua) {
      if (!k.startsWith(PREFIKS_SIMPAN)) continue;
      const asli = k.slice(PREFIKS_SIMPAN.length);
      if (prefiks.some((p) => asli.startsWith(p))) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* mode privat — tidak ada yang bisa dibersihkan */
  }
}

/* ------------------------------------------------------------------ */
/* Perawatan — jalan sekali saat modul dimuat                          */
/* ------------------------------------------------------------------ */

/** Pangkas cache persisten supaya kuota localStorage tidak tergerus:
    - entri `detail:<orderId>` lebih tua dari 10 hari → dibuang (murah
      ditarik ulang);
    - entri `orders:<from>:<to>` — sisakan 8 bulan yang paling baru disentuh.
    Diekspor agar bisa diuji. */
export function pangkasSimpanan(now = Date.now()): void {
  type Baris = { penuh: string; asli: string; at: number };
  const baris: Baris[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const penuh = localStorage.key(i);
      if (!penuh?.startsWith(PREFIKS_SIMPAN)) continue;
      try {
        const isi = JSON.parse(localStorage.getItem(penuh) ?? "") as { at?: number };
        baris.push({ penuh, asli: penuh.slice(PREFIKS_SIMPAN.length), at: isi.at ?? 0 });
      } catch {
        /* rusak — biarkan; terbuang saat berhasil dibaca */
      }
    }
  } catch {
    return;
  }
  const hapus = (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  };
  for (const b of baris) {
    if (b.asli.startsWith("detail:") && now - b.at > 10 * 24 * 3600_000) hapus(b.penuh);
  }
  const orders = baris
    .filter((b) => b.asli.startsWith("orders:"))
    .sort((a, b) => b.at - a.at);
  for (const b of orders.slice(8)) hapus(b.penuh);
}

/** Buang entri sesi versi lama (`itsfood:*` di sessionStorage, dari build
    sebelum v3) — sessionStorage itu yang hilang tiap tab ditutup dan
    menimbulkan "memuat mulu". Diekspor agar bisa diuji. */
export function bersihkanSesiLama(): void {
  try {
    const semua: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k) semua.push(k);
    }
    for (const k of semua) {
      if (!k.startsWith("itsfood:")) continue;
      try {
        sessionStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

bersihkanSesiLama();
pangkasSimpanan();
