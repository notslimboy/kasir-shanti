import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type ToneToast = "ok" | "warn" | "info";

export type ToastState = { tone: ToneToast; text: string; spin?: boolean } | null;

/* Letak toast.
 *
 * `kanan-bawah` = laporan singkat yang selesai (default app).
 * `atas-tengah` = proses yang sedang berjalan. Proses-import butuh
 *   beberapa detik, dan kasir sedang menatap daftar draft — bukan pojok
 *   kanan bawah. Toast di tengah area draft justru menutupi tabel yang
 *   sedang diperiksa, dan spinner di tengah-tengah area itu terbaca
 *   sebagai "halaman sedang memuat", bukan "saya sedang menyimpan 3 dari
 *   20 struk". Di atas tengah, statusnya selalu terlihat tanpa menutupi
 *   apa pun yang sedang dibaca. */
export type PosisiToast = "kanan-bawah" | "atas-tengah";

const POSISI: Record<PosisiToast, string> = {
  "kanan-bawah": "bottom-5 right-5",
  "atas-tengah": "top-20 left-1/2 -translate-x-1/2",
};

const WARNA: Record<ToneToast, string> = {
  ok: "bg-primary text-primary-foreground",
  warn: "bg-[#F3DBA2] text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]",
  /* Proses: netral dan berbingkai, supaya tidak terbaca sebagai hasil
     (hijau) maupun kesalahan (kuning) sebelum memang diketahui. */
  info: "border border-border bg-card text-foreground",
};

/* Toast laporan singkat.
 *
 * Dulu pesan "3 item masuk Hold #1" muncul sebagai chip tepat di samping
 * tombolnya. Dua masalah: susunan tombolnya bergeser saat pesan muncul
 * (tombol melompat ke kanan, dan itu terbaca sebagai glitch), dan pesan
 * seperti "Hold #1 dimuat" tidak punya tombol di sebelahnya — jadi
 *bergantung pada letak tombol yang kebetulan ada.
 *
 * Sekarang pesannya melayang tanpa mendorong apa pun: selesai di pojok
 * kanan bawah, sedang berjalan di atas tengah.
 */
export function Toast({ toast, posisi = "kanan-bawah" }: { toast: ToastState; posisi?: PosisiToast }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          /* key ikut tone+teks supaya pergantian Crossfade, bukan
             elemen yang sama yang berubah bentuk jadi pesan berikutnya. */
          key={`${posisi}-${toast.tone}-${toast.text}`}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: posisi === "atas-tengah" ? -12 : 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: posisi === "atas-tengah" ? -8 : 8, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className={
            "pointer-events-none fixed z-50 flex max-w-[min(90vw,26rem)] items-center gap-2.5 " +
            "rounded-2xl px-4 py-3 text-sm font-semibold shadow-pop " +
            POSISI[posisi] +
            " " +
            WARNA[toast.tone]
          }
        >
          {toast.spin ? (
            <motion.span
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
              className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent"
            />
          ) : (
            toast.tone === "ok" && <span aria-hidden>✓</span>
          )}
          <span className="min-w-0">{toast.text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ==========================================================================
   Toast yang tahu kapan harus hilang.

   Halaman sebelumnya menyimpan toast sebagai state biasa dan membiarkannya
   begitu aksi selesai: toast "struk dihapus permanen" tetap nempel di layar
   sampai halaman di-refresh — padahal pekerjaannya selesai 5 detik lalu.

   Aturannya:
   - laporan singkat (ok / warn) hilang sendiri setelah LAMA_TOAST ms
   - proses yang sedang jalan (`spin`) TIDAK hilang sendiri, karena
     "Menyimpan struk 3 dari 20" bukan hasil, itu status
   - pesan baru membatalkan timer lama, jadi update progres tidak membuat
     toast hilang lebih awal
   ========================================================================== */

export const LAMA_TOAST = 4500;

export function useToast(): [ToastState, (t: ToastState) => void] {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pasang = useCallback((t: ToastState) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (t && !t.spin) {
      timer.current = setTimeout(() => setToast(null), LAMA_TOAST);
    }
    setToast(t);
  }, []);

  /* Timer harus berhenti saat halaman dilepas — kalau tidak, setTimeout
     masih pegang state halaman yang sudah tidak ada, dan toast berikutnya
     bisa hilang karena timer lama. */
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return [toast, pasang];
}
