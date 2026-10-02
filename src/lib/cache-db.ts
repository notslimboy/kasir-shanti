/* ==========================================================================
   Cache lokal (IndexedDB).

   Kenapa bukan localStorage: localStorage dibatasi ±5 MB per situs, dan
   katalog saja sudah 3.003 KB (1.099 produk + 3.297 varian). Kalau data
   penjualan ikut disimpan di sana, kuota habis dan penulisan GAGAL SENGAJA
   tanpa error yang terlihat — cache-nya rapuh tanpa ada yang sadari.
   IndexedDB punya kuota jauh lebih besar dan tidak dibatasi segitu.

   Pola pakai: "tampilkan yang tersimpan, lalu tarik yang terbaru diam-diam".
   App tidak pernah menunggu cache — cache hanya supaya layar terisi
   seketika, lalu diganti begitu data asli datang.

   Semua fungsi gagal diam-diam. Cache adalah kenyamanan; kalau tidak bisa
   dipakai, aplikasi tetap harus jalan dengan data dari server.
   ========================================================================== */

/* Batas waktu untuk SETIAP operasi. Tanpa ini, satu Promise IndexedDB yang
   tidak resolve — upgrade yang diblokir tab lain, storage penuh, atau browser
   yang sedang suspend — akan menggantung seluruh aplikasi, karena pemuatan
   data menunggu cache sebelum menampilkan apa pun. Di layar kasir, "hang"
   jauh lebih buruk daripada "kosong sebentar". */
const BATAS_MS = 1500;

export function denganBatas<T>(p: Promise<T>, nilai: T): Promise<T> {
  return new Promise((resolve) => {
    let selesai = false;
    const tutup = (v: T) => {
      if (selesai) return;
      selesai = true;
      resolve(v);
    };
    p.then((v) => tutup(v), () => tutup(nilai));
    setTimeout(() => tutup(nilai), BATAS_MS);
  });
}

const NAMA_DB = "kasir-cache";
const NAMA_STORE = "data";
const VERSI_DB = 1;

export type CacheItem<T> = { ts: number; data: T };

/** Satu entri cache yang sudah dilepas dari bentuknya, untuk backup. */
export type CacheEntri = { key: string; ts: number; data: unknown };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function bukaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(NAMA_DB, VERSI_DB);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(NAMA_STORE)) db.createObjectStore(NAMA_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // Mode privat / storage diblokir: tidak ada cache, bukan error fatal.
      req.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

export async function cacheBaca<T>(key: string): Promise<CacheItem<T> | null> {
  const db = await denganBatas(bukaDb(), null);
  if (!db) return null;
  return denganBatas(new Promise<CacheItem<T> | null>((resolve) => {
    try {
      const tx = db.transaction(NAMA_STORE, "readonly");
      const req = tx.objectStore(NAMA_STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as CacheItem<T> | undefined;
        resolve(v && typeof v.ts === "number" ? v : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }), null);
}

export async function cacheTulis<T>(key: string, data: T): Promise<void> {
  const db = await denganBatas(bukaDb(), null);
  if (!db) return;
  await denganBatas(new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(NAMA_STORE, "readwrite");
      tx.objectStore(NAMA_STORE).put({ ts: Date.now(), data }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  }), undefined);
}

export async function cacheHapus(...keys: string[]): Promise<void> {
  const db = await denganBatas(bukaDb(), null);
  if (!db || keys.length === 0) return;
  await denganBatas(new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(NAMA_STORE, "readwrite");
      const store = tx.objectStore(NAMA_STORE);
      for (const k of keys) store.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  }), undefined);
}

/** Buang semua entri yang kuncinya diawali prefix.
 *
 * Dipakai setelah menulis ke database: cache per-rentang dihapus semua
 * sekaligus, bukan hanya rentang yang sedang dibuka, karena structs baru
 * bisa muncul di rentang mana pun — termasuk yang sedang tidak terlihat. */
export async function cacheHapusAwalan(prefix: string): Promise<void> {
  const db = await denganBatas(bukaDb(), null);
  if (!db) return;
  const kunci = await denganBatas(
    new Promise<string[]>((resolve) => {
      try {
        const req = db.transaction(NAMA_STORE, "readonly").objectStore(NAMA_STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    }),
    [],
  );
  await cacheHapus(...kunci.filter((k) => k.startsWith(prefix)));
}

/** Semua entri cache beserta kuncinya, untuk backup.
 *
 *  Menyertakan `ts` karena backup bukan hanya isinya: waktu cache
 *  menentukan apakah restore menghasilkan data yang dianggap basi saat
 *  aplikasi dibuka. Tanpa `ts`, restore selalu menghasilkan cache yang
 *  terlihat berumur 0 detik — dan itu berbohong.
 *
 *  Gagal = array kosong, bukan error. Backup tanpa cache masih berguna
 *  (minimal setelan printer), jadi tidak boleh menggagalkan proses. */
export async function cacheSemua(): Promise<CacheEntri[]> {
  const db = await denganBatas(bukaDb(), null);
  if (!db) return [];
  return denganBatas(
    new Promise<CacheEntri[]>((resolve) => {
      try {
        const store = db.transaction(NAMA_STORE, "readonly").objectStore(NAMA_STORE);
        const reqKunci = store.getAllKeys();
        const reqNilai = store.getAll();
        /* getAllKeys dan getAll harus dijadwalkan dalam transaksi yang
           SAMA. Dua transaksi terpisah bisa melihat versi berbeda kalau
           ada yang menulis di antaranya, dan hasilnya pasangan
           kunci/nilai yang tertukar. */
        reqKunci.onsuccess = () => {
          reqNilai.onsuccess = () => {
            const kunci = (reqKunci.result as IDBValidKey[]).map(String);
            const nilai = reqNilai.result as (CacheItem<unknown> | undefined)[];
            resolve(
              kunci.flatMap((k, i) => {
                const v = nilai[i];
                return v && typeof v.ts === "number" ? [{ key: k, ts: v.ts, data: v.data }] : [];
              }),
            );
          };
          reqNilai.onerror = () => resolve([]);
        };
        reqKunci.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    }),
    [],
  );
}

/** Tulis satu batch entri cache. Dipakai restore: seluruh backup masuk
 *  dalam satu transaksi, jadi tidak pernah ada keadaan setengah jadi di
 *  mana produk sudah ada tapi struk-nya belum. */
export async function cacheTulisBanyak(entries: CacheEntri[]): Promise<void> {
  const db = await denganBatas(bukaDb(), null);
  if (!db || entries.length === 0) return;
  await denganBatas(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(NAMA_STORE, "readwrite");
        const store = tx.objectStore(NAMA_STORE);
        for (const e of entries) store.put({ ts: e.ts, data: e.data }, e.key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    }),
    undefined,
  );
}

/** Buang semua cache KECUALI yang namanya ada di `kecuali`.
 *
 *  Pengecualian punya alasan: ada cache yang bukan data pasar dan tidak
 *  boleh ikut terhapus. Contohnya daftar order tersimpan - yang justru
 *  sengaja dikosongkan setelah transaksi disimpan, supaya angka di layar
 *  bukan hasil hitungan dari data yang sudah usang. Kalau daftar order ikut
 *  terhapus, kasir baru menyelesaikan satu order dan semua order lain yang
 *  sedang menunggu ikut hilang - itu lebih buruk dari angka basi satu detik. */
export async function cacheKosongkanKecuali(...kecuali: string[]): Promise<void> {
  const db = await denganBatas(bukaDb(), null);
  if (!db) return;
  await denganBatas(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(NAMA_STORE, "readwrite");
        const store = tx.objectStore(NAMA_STORE);
        const req = store.getAllKeys();
        req.onsuccess = () => {
          for (const k of (req.result as IDBValidKey[]).map(String)) {
            if (!kecuali.includes(k)) store.delete(k);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    }),
    undefined,
  );
}

/** Buang semua cache. Dipakai setelah transaksi disimpan supaya angka di
    layar bukan hasil hitungan dari data yang sudah usang. */
export async function cacheKosongkan(): Promise<void> {
  const db = await denganBatas(bukaDb(), null);
  if (!db) return;
  await denganBatas(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(NAMA_STORE, "readwrite");
        tx.objectStore(NAMA_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    }),
    undefined,
  );
}
