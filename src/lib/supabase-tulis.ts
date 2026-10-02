import { headerRest, SUPABASE_URL } from "@/supabase/client";

/* ==========================================================================
   Menulis struk ke Supabase.

   Tiga operasi: hapus (void), restore, dan hapus permanen.

   Kenapa "hapus" itu SOFTWARE delete lewat `deleted_at`, bukan `DELETE FROM`:

   1. Reversibel. Salah hapus itu berarti satu struk hilang permanen beserta
      seluruh isinya, dan itu tidak bisa dikembalikan tanpa chat asal.
   2. App sudah punya tab "Terhapus" dan cara restore-nya, jadi pola soft
      delete ini bukan tambahan baru — cuma belum disambungkan dari UI.
   3. Angkanya tetap bisa ditelusuri: kartu KPI dan omset mengabaikan struk
      terhapus, tapi barisnya masih ada kalau perlu dicek.

   Hapus permanen (lihat di bawah file) satu-satunya yang memakai DELETE, dan
   hanya boleh jalan kalau struknya sudah berstatus terhapus.

   `stock_restored_on_delete` sengaja di-set 0 di kedua arah. Kolom itu
   penanda "stok sudah dikembalikan ke katalog", dan hapus struk di sini
   TIDAK menyentuh stok: stok produk dikelola batch harian yang terpisah,
   dan menyentuhinya dari sini akan mengembalikan jumlah dua kali.
   */

export type HasilTulis = { ok: true } | { ok: false; pesan: string };

async function patchStruk(id: number, body: Record<string, unknown>): Promise<HasilTulis> {
  const url = `${SUPABASE_URL}/rest/v1/sales?id=eq.${id}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      ...headerRest(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    return { ok: false, pesan: `Gagal menyimpan ke server (${r.status}).` };
  }
  /* PATCH tanpa filter yang cocok mengembalikan array kosong, bukan error.
     Kalau kosong, tidak ada yang berubah — dan itu harus dilaporkan, bukan
     dianggap berhasil. */
  const data = (await r.json()) as unknown[];
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, pesan: "Struk tidak ditemukan di server." };
  }
  return { ok: true };
}

/** Tandai struk terhapus (void). */
export function hapusStruk(id: number): Promise<HasilTulis> {
  return patchStruk(id, {
    deleted_at: new Date().toISOString(),
    stock_restored_on_delete: 0,
  });
}

/** Kembalikan struk yang terhapus ke daftar aktif. */
export function restoreStruk(id: number): Promise<HasilTulis> {
  return patchStruk(id, {
    deleted_at: null,
    stock_restored_on_delete: 0,
  });
}

/* -------------------------------------------------------------------------
   Hapus permanen

   Berbeda sifatnya dari "hapus struk" di atas: yang itu cuma memindahkan ke
   tab Terhapus dan masih bisa dibalikin. Yang ini benar-benar hilang dari
   database, jadi dua syarat: struk harus sudah terhapus, dan pemanggil harus
   lewat konfirmasi terpisah.

   Syarat "sudah terhapus" bukan sekadar formalitas. Kalau tombol ini
  reachable untuk struk yang masih hidup, satu klik yang salah target
   menghapus struk yang sedang dipakai kasir — dan tidak ada yang bisa
   mengembalikannya.

   sale_items dan sale_payments dihapus lebih dulu karena keduanya punya
   foreign key ke sales.id. Kalau relasinya cascade, DELETE di bawahnya cuma
   jadi no-op — urutan ini aman untuk dua-duanya.
   ------------------------------------------------------------------------- */

async function hapusAnak(table: "sale_items" | "sale_payments", saleId: number): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?sale_id=eq.${saleId}`;
  const r = await fetch(url, {
    method: "DELETE",
    headers: { ...headerRest(), Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
}

/** Hapus struk yang sudah terhapus, permanen. Tidak bisa dibalikin. */
export async function hapusStrukPermanen(id: number): Promise<HasilTulis> {
  /* Ditolak kalau struk ternyata masih hidup. */
  const cek = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?id=eq.${id}&deleted_at=not.is.null&select=id`,
    { headers: { ...headerRest(), Prefer: "return=representation" } },
  );
  if (!cek.ok) return { ok: false, pesan: `Gagal memeriksa struk (${cek.status}).` };
  const terjual = (await cek.json()) as unknown[];
  if (!Array.isArray(terjual) || terjual.length === 0) {
    return {
      ok: false,
      pesan:
        "Struk ini belum dihapus. Hapus dulu lewat tombol Hapus — yang dipindah ke Terhapus masih bisa dikembalikan.",
    };
  }

  try {
    await hapusAnak("sale_items", id);
    await hapusAnak("sale_payments", id);
  } catch (e) {
    return { ok: false, pesan: `Gagal menghapus rincian struk: ${(e as Error).message}` };
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headerRest(), Prefer: "return=representation" },
  });
  if (!r.ok) return { ok: false, pesan: `Gagal menghapus struk (${r.status}).` };
  const dihapus = (await r.json()) as unknown[];
  if (!Array.isArray(dihapus) || dihapus.length === 0) {
    return { ok: false, pesan: "Struk tidak ditemukan di server." };
  }
  return { ok: true };
}