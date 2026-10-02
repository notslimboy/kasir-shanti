import { motion, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";

/* ==========================================================================
   Animasi daftar yang difilter (cari produk / cari struk).

   Daftar panjang + kotak pencarian = hasil berubah tiap ketikan. Tanpa
   animasi, daftar "melompat" dan kasir kehilangan tempat matanya di antara
   hasil. Entrance pendek + stagger kecil membuat daftar terasa Cair, bukan
   flicker.

   Dua aturan supaya tidak lambat:

   1. Stagger DITAKSIK setelah ~14 item. Katalog 1.095 produk, jadi tanpa
      batas atas baris ke-200 baru selesai 3 detik setelah mengetik — dan
      baris yang muncul belakangan justru yang paling dicari.
   2. Animasi hanya jalan saat sedang menyaring (`aktif`). Daftar penuh
      saat halaman dibuka tidak perlu ikut beranimasi: 1.095 elemen yang
      mount sekaligus menahan render pertama.
   ========================================================================== */

/** Jumlah item yang masih punya delay berbeda. Sisanya delay 0. */
const MAKS_STAGGER = 14;

/** Delay per item, dalam detik. 15ms × 14 ≈ 210ms — cukup terasa, tidak
    berarti kursor tertinggal dari daftar. */
export function delayDaftar(i: number, kurangi: boolean | null): number {
  if (kurangi) return 0;
  return Math.min(i, MAKS_STAGGER) * 0.015;
}

export type ItemDaftarProps = HTMLMotionProps<"div"> & {
  /** Posisi item di daftar — dipakai untuk stagger. */
  i: number;
  /** Hanya true saat sedang memfilter. */
  aktif: boolean;
};

/** Pembungkus satu baris/kartu daftar. Pakai `layout` bila daftar ikut
    berubah posisinya (mis. pindah kolom atau pindah urutan). */
export function ItemDaftar({ i, aktif, children, ...rest }: ItemDaftarProps) {
  const kurangi = useReducedMotion();
  const hidup = aktif && !kurangi;
  return (
    <motion.div
      initial={hidup ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      /* Keluar SELALU punya animasi, tidak hanya saat sedang memfilter.
         Baris yang dihapus — draft yang dibuang, produk yang dihapus dari
         katalog — harus tetap terlihat keluar. Kalau `exit` hanya dipasang
         saat `aktif`, penghapusan terasa seperti lompatan. */
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{
        duration: hidup ? 0.18 : kurangi ? 0 : 0.15,
        delay: hidup ? delayDaftar(i, kurangi) : 0,
        ease: [0.22, 1, 0.36, 1],
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Placeholder baris kosong yang ikut muncul/hilang bareng daftar. Pakai
    `exit` supaya AnimatePresence di induknya tidak complains, tapi tetap
    boleh di-render tanpa AnimatePresence. */
export function KosongDaftar({ children, ...rest }: HTMLMotionProps<"div">) {
  const kurangi = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: kurangi ? 0 : 0.15 }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}