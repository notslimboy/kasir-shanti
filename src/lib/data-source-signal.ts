/* ==========================================================================
   Sinyal basi untuk katalog produk.

   Dipisah dari data-source.tsx supaya bisa diimpor oleh sync-google-sheet
   tanpa ketergantungan React. DataProvider di data-source.tsx mendaftarkan
   pendengar yang memicu pastikanProduk() saat sinyal dikirim.

   Pola:
     sync-google-sheet → tandaiProdukStale() → listener → pastikanProduk()
   ========================================================================== */

let produkStale = false;
let staleListeners: Array<() => void> = [];

/** Tandai katalog sebagai basi — panggil dari luar (sync Google Sheet)
    setelah data baru disimpan ke Supabase. Memicu listener yang terdaftar
    (biasanya pastikanProduk()) untuk menarik ulang. */
export function tandaiProdukStale(): void {
  produkStale = true;
  for (const cb of staleListeners) cb();
}

/** Daftarkan pendengar yang dipanggil saat katalog ditandai basi.
    Kembalikan fungsi pembatalan (panggil untuk menghapus pendengar). */
export function padaProdukStale(cb: () => void): () => void {
  staleListeners.push(cb);
  return () => {
    const i = staleListeners.indexOf(cb);
    if (i >= 0) staleListeners.splice(i, 1);
  };
}

/** Cek apakah katalog sedang ditandai basi. */
export function isProdukStale(): boolean {
  return produkStale;
}

/** Setel ulang tanda basi — dipakai setelah katalog berhasil ditarik. */
export function resetProdukStale(): void {
  produkStale = false;
}