import { kandidatJelas, rankedKandidat, varianDariNama, type KandidatProduk } from "./cocok-produk";
import { isHalfVariantName } from "./pricing";
import type { ItemImpor, PesananImpor } from "./impor-pesanan";

/* ==========================================================================
   Status draft: "Siap" atau "Perlu review".

   PRINSIP: yang belum dipastikan manusia TIDAK BOLEH masuk Dashboard
   Penjualan. Kalau struk boleh lolos dengan harga kosong, customer kosong,
   atau harga custom yang belum dicek, dashboard diam-diam berisi angka
   yang salah — dan kasir tidak pernah diberi tahu struk mana yang perlu
   diperiksa ulang. Isu blocking di bawah benar-benar menahan proses:
   proses() hanya mengambil draft yang lolos (impor-pesanan.tsx).

     blocking : barang belum dicocokkan, jumlah kosong, harga kosong,
                harga custom belum diisi, customer/tanggal kosong,
                varian separuh tidak ada di menu, atau stok kurang
     info     : tidak ada — semua isu di atas menahan proses
   */

export type IsuDraft = { pesan: string; blocking: boolean };

export function isuDraft(p: PesananImpor): IsuDraft[] {
  const isu: IsuDraft[] = [];
  if (!p.customer.trim()) isu.push({ pesan: "Customer/alamat kosong", blocking: true });
  if (!p.tanggal) isu.push({ pesan: "Tanggal chat kosong", blocking: true });
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
    /* Harga custom dicek lebih dulu supaya pesannya spesifik: "harga
       custom" lebih membantu kasir daripada "harga belum diisi". */
    if (it.perluCekHarga) {
      isu.push({ pesan: `${it.nama} pakai harga custom — isi kolom harga`, blocking: true });
      continue;
    }
    /* Harga kosong: struk Rp 0 merusak pembukuan, dan tidak ada yang
       melihatnya di dashboard. */
    if (it.harga <= 0 || it.hargaKosong) {
      isu.push({ pesan: `${it.nama} harga belum diisi`, blocking: true });
      continue;
    }
    if (it.perluVarianSeparuh) {
      isu.push({ pesan: `${it.nama} varian Separuh tidak ada di menu`, blocking: true });
    }
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
       mengarang harga. Kalau chat sudah menyebut harga, angka itu sudah jadi
       keputusan orang, jadi tidak perlu dicek lagi. */
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
      perluCekHarga: custom && harga <= 0,
      hargaKosong: harga <= 0,
      stok: pilih.stok,
    };
  });
  const subtotal = items.reduce((a, it) => a + it.qty * it.harga, 0);
  return { ...p, items, subtotal, total: subtotal + p.ongkir };
}

/* -------------------------------------------------------------------------
   Porsi separuh.

   CSV parser menulis porsi separuh sebagai quantity 0.5 + note
   "setengah porsi" (instruksi_ai_parser.md). Aplikasi memakai konsep lain:
   varian "Separuh" dengan quantity 1 (contoh-impor.ts, Kasir). Dua bentuk itu
   harus bertemu di satu tempat, kalau tidak separuh tidak pernah terdeteksi.

   Kenapa harus jadi varian, bukan dibiarkan 0.5:

     qty 0.5 x harga normal  vs  varian Separuh x 1
     Tempe Mendol 10.000 ->   5.000      |  10.000   <- hilang Rp 5.000
     Es Kacang Ijo 10.000 -> 5.000      |  10.000   <- hilang Rp 5.000
     Lodeh Rebung 25.000 -> 12.500      |  12.500   <- sama saja

   Varian "Separuh" punya lantai minimum Rp 10.000 (halfVariantPrice,
   pricing.ts). qty 0.5 x normal tidak pernah ikut aturan itu, jadi setiap
   item di bawah Rp 20.000 kehilangan uang di setiap porsi separuh — dan
   struknya tetap tersimpan karena tidak ada yang menandai.

   Harga diambil dari varian Separuh di katalog. Kalau produk tidak punya
   varian itu, harga TIDAK ditebak: draft ditahan (perluVarianSeparuh) supaya
   kasir memilih sendiri lewat "Pilih Barang".
   ---------------------------------------------------------------------- */

const QTY_SEPARUH = 0.5;

export function normalisasiSeparuh(p: PesananImpor, katalog: KandidatProduk[]): PesananImpor {
  const items = p.items.map((it): ItemImpor => {
    if (it.qty !== QTY_SEPARUH) return it;
    /* Sudah separuh: halfVariantName produk menandai "Oseng Tahu Tempe 1/2",
       dan pesan "Lodeh Rebung 1/2" sudah terbaca lewat varianDariNama.
       Mengubahnya lagi jadi seperempat porsi. */
    if (isHalfVariantName(it.productName) || varianDariNama(it.nama)) return it;
    if (!it.productClientId) return it;

    const produk = katalog.find((k) => k.client_id === it.productClientId);
    const separuh = produk?.variants.find((v) => isHalfVariantName(v.name));
    if (!produk || !separuh) return { ...it, perluVarianSeparuh: true };

    /* Harga dari kolom `harga` di CSV tetap menang: chat yang menyebut harga
       adalah keputusan orang. Harga katalog varian biasa TIDAK ikut — itu baru
       diisi sebagai placeholder oleh cocokkanDraft, dan kalau ikut, harga
       separuh yang benar akan tertimpa harga porsi penuh. */
    const harga = it.hargaDariCsv && it.harga > 0 ? it.harga : separuh.price;
    return {
      ...it,
      qty: 1,
      varian: separuh.name,
      harga,
      hargaKosong: harga <= 0,
      perluCekHarga: separuh.pricing_type === "custom" && harga <= 0,
      perluVarianSeparuh: false,
    };
  });
  const subtotal = items.reduce((a, it) => a + it.qty * it.harga, 0);
  return { ...p, items, subtotal, total: subtotal + p.ongkir };
}