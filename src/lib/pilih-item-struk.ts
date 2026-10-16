import type { Product } from "./menu-seed";

/* ==========================================================================
   Daftar menu untuk "Tambah item" di form Ubah Data struk.

   Struk lama tidak bisa dilengkapi: satu item yang salah tidak dicatat berarti
   kasir harus membatalkan seluruh struk. Karena itu drawer struk punya
   tombol tambah item, dan di sini yang disiapkan adalah daftar pilihannya.

   Aturannya sama dengan katalog Kasir: hanya varian AKTIF yang bisa dipilih,
   dan varian berharga custom masuk sebagai harga 0 — kasir yang mengisi
   angkanya di baris itu, bukan ditebak dari harga varian lain.
   ========================================================================== */

export type OpsiItemStruk = {
  /** Unik per produk+varian; dipakai sebagai key daftar. */
  key: string;
  /** Yang ditampilkan dan dipakai sebagai nama baris. */
  label: string;
  name: string;
  variant: string;
  price: number;
  /** Harga belum diketahui; baris dimulai dari 0 dan harus diisi kasir. */
  custom: boolean;
  productClientId: string;
  variantClientId: string;
};

/** Nama varian yang tidak perlu disebut: "Normal" dan string kosong. */
function varianPerluDisebut(nama: string): boolean {
  const n = nama.trim().toLowerCase();
  return n !== "" && n !== "normal";
}

export function opsiItemStruk(produk: Product[]): OpsiItemStruk[] {
  const hasil: OpsiItemStruk[] = [];
  for (const p of produk) {
    /* Produk tanpa varian aktif tidak bisa ditambahkan: harganya tidak
       diketahui, dan baris tanpa harga hanya menambah pekerjaan kasir. */
    const varian = (p.variants ?? []).filter((v) => v.active);
    for (const v of varian) {
      const namaVarian = String(v.name ?? "").trim();
      const custom = v.pricing_type === "custom" || Number(v.price) <= 0;
      hasil.push({
        key: `${p.client_id}|${v.client_id}`,
        label: varianPerluDisebut(namaVarian) ? `${p.name} · ${namaVarian}` : p.name,
        name: p.name,
        variant: namaVarian,
        price: custom ? 0 : Number(v.price),
        custom,
        productClientId: p.client_id,
        variantClientId: v.client_id,
      });
    }
  }
  return hasil;
}

/** Saring untuk kotak pencarian. `batas` penting: katalog berisi ratusan
    produk, dan menggambar semuanya di dalam drawer membuat kasir menunggu
    tanpa alasan — yang dicari selalu bisa dipersempit dengan mengetik. */
export function cariOpsiItem(
  opsi: OpsiItemStruk[],
  cari: string,
  batas = 40,
): { tampil: OpsiItemStruk[]; total: number } {
  const q = cari.trim().toLowerCase();
  const cocok = q === "" ? opsi : opsi.filter((o) => o.label.toLowerCase().includes(q));
  return { tampil: cocok.slice(0, batas), total: cocok.length };
}
