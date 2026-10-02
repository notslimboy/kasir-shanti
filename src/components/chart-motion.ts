/* ==========================================================================
   Konfigurasi animasi chart — dipakai semua chart supaya terasa satu sistem.

   Diformat untuk disebar ke <Area>/<Bar>/<Pie>/<Line>. Karena tiap halaman
   di-unmount saat pindah route, chart baru selalu remount → animasi intro
   ikut terulang setiap ganti halaman, tanpa perlu state khusus.
   ========================================================================== */

export const CHART_ANIM = {
  isAnimationActive: true,
  animationBegin: 60,
  animationDuration: 800,
  animationEasing: "ease-out",
} as const;

/** Versi lebih cepat untuk chart kecil (donut, sparkline). */
export const CHART_ANIM_FAST = {
  isAnimationActive: true,
  animationBegin: 40,
  animationDuration: 550,
  animationEasing: "ease-out",
} as const;

/* ==========================================================================
   Donut metode pembayaran.

   Dua masalah yang muncul di sini:

   1. strokeWidth 3px dengan warna kartu putih. Metode yang porsinya kecil
      (mis. Transfer 1% dari 30 hari) jadi selebar slice-nya lebih tipis
      dari strokenya sendiri — hasilnya tidak ada yang tampil sama sekali,
      seolah metode itu tidak pernah dipakai. Strokenya ditipiskan, dan
      sudut antar slice (paddingAngle) yang memisahkan, bukan garis putih.

   2. Tanpa tooltip, slice setipis itu mustahil diidentifikasi; legendanya
      hanya menampilkan persentase, jadi kasir tidak bisa tahu arc mana
      yang dia maksud kalau sedang hover.
   ========================================================================== */

export const PIE_TIP = {
  /* 1px: cukup untuk memisahkan tanpa menelan slice tipis. */
  strokeWidth: 1,
  stroke: "var(--card)",
  paddingAngle: 2,
  startAngle: 90,
  endAngle: -270,
} as const;

/** Nama metode yang dipotong untuk label tengah donat. */
export function potongNama(nama: string, maks = 12): string {
  return nama.length > maks ? nama.slice(0, maks - 1) + "…" : nama;
}
