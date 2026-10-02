import { kandidatJelas, rankedKandidat, varianDariNama, type KandidatProduk } from "./cocok-produk";
import type { ItemImpor, PesananImpor } from "./impor-pesanan";

/* ==========================================================================
   Status draft: "Siap" atau "Perlu review".

   Aturan ini disalin dari getDraftIssues (script.js:5915). Yang menentukan
   boleh/tidaknya diproses adalah isu BLOCKING; isu lain tetap ditampilkan
   supaya kasir tahu, tapi tidak Essence memakai draft-nya.

     blocking : barang belum dicocokkan, jumlah kosong/tidak ada,
                atau stok katalog kurang untuk jumlah itu
     info     : customer/tanggal kosong, harga custom perlu dicek
   ========================================================================== */

export type IsuDraft = { pesan: string; blocking: boolean };

export function isuDraft(p: PesananImpor): IsuDraft[] {
  const isu: IsuDraft[] = [];
  if (!p.customer.trim()) isu.push({ pesan: "Customer/alamat kosong", blocking: false });
  if (!p.tanggal) isu.push({ pesan: "Tanggal chat kosong", blocking: false });
  if (p.items.length === 0) return [{ pesan: "Item kosong", blocking: true }];

  for (const it of p.items) {
    if (!it.productClientId) {
      isu.push({ pesan: `${it.nama} belum cocok barang`, blocking: true });
      continue;
    }
    if (it.qty <= 0) {
      isu.push({ pesan: `${it.nama} jumlah kosong`, blocking: true });
      continue;
    }
    if (it.perluCekHarga) isu.push({ pesan: `${it.nama} pakai harga custom, cek variasinya`, blocking: false });
    if (it.stok !== null && it.qty > it.stok) {
      isu.push({ pesan: `${it.nama} stok kurang (sisa ${it.stok})`, blocking: true });
    }
  }
  return isu;
}

export const blockingDraft = (p: PesananImpor): IsuDraft[] => isuDraft(p).filter((i) => i.blocking);
export const siapDraft = (p: PesananImpor): boolean => blockingDraft(p).length === 0;
export const statusDraft = (p: PesananImpor): "Siap" | "Perlu review" => (siapDraft(p) ? "Siap" : "Perlu review");

/** Total struk & item yang siap diproses. */
export function rekapDraft(daftar: PesananImpor[]) {
  const siap = daftar.filter(siapDraft);
  return {
    semua: daftar.length,
    perluReview: daftar.length - siap.length,
    siap: siap.length,
    itemSiap: siap.reduce((a, p) => a + p.items.length, 0),
  };
}

/* -------------------------------------------------------------------------
   Pencocokan barang saat draft dibuat.

   Sama seperti versi lama: kandidat terbaik langsung dipakai kalau jelas
   lebih cocok daripada runner-up; kalau seri, barang TIDAK chosen
   diam-diam — ia tetap perlu dipilih kasir lewat "Pilih barang".
   ---------------------------------------------------------------------- */

export function cocokkanDraft(
  p: PesananImpor,
  katalog: KandidatProduk[],
): PesananImpor {
  const items = p.items.map((it): ItemImpor => {
    if (it.productClientId) return it;
    const daftar = rankedKandidat(katalog, it.nama);
    if (!daftar.length || !kandidatJelas(daftar)) return it;
    const pilih = daftar[0].produk;
    const v = varianDariNama(it.nama);
    const varian = (v && pilih.variants.find((x) => x.name.toLowerCase() === v.toLowerCase())) ||
      pilih.variants.find((x) => x.name.toLowerCase() === "normal") ||
      pilih.variants[0];
    /* Harga custom (pricing_type custom) sengaja TIDAK diambil: nilainya
       harus diketik orang, dan diisi sendiri — menebaknya berarti
       mengarang harga. */
    const custom = varian?.pricing_type === "custom";
    /* Urutan harga mengikuti getDraftItemUnitPrice di script.js: harga yang
       ditulis di CSV selalu menang. Kalau tidak ada, baru harga varian. */
    const harga = it.harga > 0 ? it.harga : custom ? 0 : varian?.price ?? 0;
    return {
      ...it,
      productClientId: pilih.client_id,
      productName: pilih.name,
      varian: v ? varian?.name ?? it.varian : varian?.name ?? it.varian,
      harga,
      perluCekHarga: custom,
      hargaKosong: harga <= 0,
      stok: pilih.stok,
    };
  });
  const subtotal = items.reduce((a, it) => a + it.qty * it.harga, 0);
  return { ...p, items, subtotal, total: subtotal + p.ongkir };
}