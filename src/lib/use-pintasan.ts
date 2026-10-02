import { useEffect } from "react";

/* ==========================================================================
   Pintasan papan ketik.

   F4 = cetak laporan penjualan (dari versi lama). Dicek lewat
   event.key === "F4", bukan keyCode, karena.keyCode tidak ada lagi di
   browser modern dan nilainya beda antar browser.

   Aturan yang dijaga:
     - di halaman yang punya tombolnya saja (dilewati di halaman lain)
     - tidak saat sedang mengetik di input/textarea/contenteditable,
       supaya mengetik angka tidak memicu cetak
     - tidak saat dialog native terbuka (cetak/print dialog)
   ========================================================================== */

export function usePintasan(
  tombol: Record<string, () => void>,
  /** Aktif atau tidak — dipakai agar tidak bereaksi di halaman yang tidak
      punya tombol untuk pintasan itu. */
  aktif = true,
): void {
  useEffect(() => {
    if (!aktif) return;
    const onKey = (e: KeyboardEvent) => {
      const jalankan = tombol[e.key];
      if (!jalankan) return;
      const target = e.target as HTMLElement | null;
      const mengetik =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (mengetik) return;
      // Dialog cetak browser sudah punya F4-nya sendiri.
      if (typeof window !== "undefined" && window.matchMedia?.("print").matches) return;
      e.preventDefault();
      jalankan();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tombol, aktif]);
}
