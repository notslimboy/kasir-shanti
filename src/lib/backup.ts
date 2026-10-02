/* ==========================================================================
   Backup & restore data perangkat.

   Yang dicakup:

   - Cache IndexedDB (katalog produk, varian, inti: struk + customer).
   - localStorage: setelan struk/printer, tema, konfigurasi Google Sheet.

   Yang TIDAK dicakup, dan itu penting:

   - Data di Supabase. Transaksi yang sudah tersimpan di server ada di
     Supabase, bukan di perangkat — app ini tidak bisa mengunduh seluruh
     riwayat 2.000+ struk tanpa borosnya kuota. Backup ini adalah
     "data perangkat", bukan "cadangan transaksi".
   - sessionStorage (draft keranjang yang sedang diketik).

   Format file JSON biasa: bisa dibuka dan dibaca orang tanpa aplikasi
   ini, dan ukurannya kecil karena isinya sudah cache — bukan arsip.
   ========================================================================== */

/* Kunci localStorage milik aplikasi. Dipakai prefix agar tidak ikut
   menimpa milik situs lain di origin yang sama (Vite dev server memakai
   localhost yang sama untuk beberapa proyek). */
const AWALAN = "kasir";

/* Nama file berstempel waktu. Tanpa tanggal, "Backup 1", "Backup 2" —
   dan sesudah ketiga backup, tidak ada cara tahu yang mana yang benar. */
export function namaFileBackup(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `kasir-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export type IsiBackup = {
  /** Versi format. Backup yang formatnya berbeda ditolak, bukan
   *  dipaksakan — restore setengah jadi lebih buruk daripada ditolak. */
  format: 1;
  dibuatPada: string;
  cache: { key: string; ts: number; data: unknown }[];
  local: Record<string, string>;
};

function localMilikKasir(): Record<string, string> {
  const keluar: Record<string, string> = {};
  if (typeof localStorage === "undefined") return keluar;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(AWALAN)) keluar[k] = localStorage.getItem(k) ?? "";
    }
  } catch {
    // localStorage diblokir (mode privat): backup tanpa setelan tetap
    // berguna, jadi bukan error fatal.
  }
  return keluar;
}

export type HasilBackup = { ok: true; namaFile: string; ukuran: number } | { ok: false; pesan: string };

/** Susun backup lalu unduh sebagai file. */
export async function unduhBackup(): Promise<HasilBackup> {
  const { cacheSemua } = await import("@/lib/cache-db");
  const cache = await cacheSemua();
  const isi: IsiBackup = {
    format: 1,
    dibuatPada: new Date().toISOString(),
    cache,
    local: localMilikKasir(),
  };

  let teks: string;
  try {
    teks = JSON.stringify(isi, null, 2);
  } catch (e) {
    return { ok: false, pesan: `Backup gagal: ${(e as Error).message}` };
  }

  try {
    const blob = new Blob([teks], { type: "application/json" });
    const nama = namaFileBackup();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nama;
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* revokeObjectURL langsung setelah klik bisa membatalkan unduhan di
       Safari. Ditunda satu tick supaya browser sempat mengambil blob-nya. */
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, namaFile: nama, ukuran: blob.size };
  } catch (e) {
    return { ok: false, pesan: `Backup gagal: ${(e as Error).message}` };
  }
}

export type HasilRestore =
  | { ok: true; jumlahCache: number; dibuatPada: string }
  | { ok: false; pesan: string };

/** Baca file backup, validasi, lalu timpa cache + localStorage.
 *
 *  Restore TIDAK menyentuh Supabase. Setelah restore, aplikasi dimuat ulang
 *  supaya semua halaman membaca data yang sama — dan menarik data terbaru
 *  dari server begitu ada koneksi, jadi restore tidak pernah jadi sumber
 *  kebenaran yang lebih basi daripada server. */
export async function pulihkanBackup(teks: string): Promise<HasilRestore> {
  let isi: unknown;
  try {
    isi = JSON.parse(teks);
  } catch {
    return { ok: false, pesan: "File bukan JSON yang valid — mungkin bukan file backup aplikasi ini." };
  }

  const b = isi as Partial<IsiBackup>;
  if (!b || b.format !== 1 || !Array.isArray(b.cache)) {
    return {
      ok: false,
      pesan: "Format backup tidak dikenali. Hanya backup dari versi aplikasi ini yang bisa dipulihkan.",
    };
  }

  const { cacheTulisBanyak } = await import("@/lib/cache-db");
  // Entri yang bentuknya tidak dikenal dilewati, bukan menggagalkan
  // seluruh restore: satu kunci rusak tidak boleh menghapus semua data
  // yang lain.
  const entri = b.cache.filter(
    (e): e is { key: string; ts: number; data: unknown } =>
      !!e && typeof e.key === "string" && typeof e.ts === "number",
  );
  await cacheTulisBanyak(entri);

  if (typeof localStorage !== "undefined" && b.local && typeof b.local === "object") {
    try {
      for (const [k, v] of Object.entries(b.local)) {
        if (k.startsWith(AWALAN) && typeof v === "string") localStorage.setItem(k, v);
      }
    } catch {
      // Setelan gagal ditulis, tapi cache sudah masuk. Lebih baik
      // setengah berhasil daripada membatalkan semuanya.
    }
  }

  return { ok: true, jumlahCache: entri.length, dibuatPada: b.dibuatPada ?? "tidak diketahui" };
}

/** Baca file yang dipilih user sebagai teks. */
export function bacaFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(new Error("File tidak bisa dibaca."));
    fr.readAsText(file);
  });
}