import { useRef, useState } from "react";
import { rapikanCatatan } from "@/lib/catatan-item";

/* ==========================================================================
   Catatan per baris di keranjang kasir.

   Catatan dinormalkan SEKALI, saat kasir selesai mengetik — bukan pada
   setiap ketukan. Menormalkan sambil mengetik terlihat tidak berbahaya,
   tetapi menghapus teks yang sedang ditulis: `rapikanCatatan` memangkas
   spasi, jadi setelah "tanpa" diikuti spasi, isinya kembali jadi "tanpa" dan
   huruf berikutnya menempel — "tanpasambel". Akibatnya kasir tidak pernah
   bisa menulis catatan lebih dari satu kata.

   Karena itu draft tinggal di sini, dan hanya hasil akhirnya yang melewati
   normalizer. Komponen ini dipasang untuk baris yang sedang diedit (lihat
   `sCatatan` di kasir.tsx) dan WAJIB diberi `key` per baris: tanpa itu React
   memakai ulang instance yang sama untuk baris berikutnya, dan draft baris
   lama ikut terbawa.
   ========================================================================== */

export function CatatanInput({
  awal,
  ariaLabel,
  placeholder,
  className,
  onSelesai,
}: {
  /** Catatan yang sudah tersimpan untuk baris ini; "" kalau belum ada. */
  awal: string;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  /** Dipanggil sekali dengan catatan yang sudah dinormalkan. `undefined`
   *  berarti baris ini tidak punya catatan. */
  onSelesai: (catatan: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(awal);
  /* Enter menutup input, dan penutupan itu melepas komponen ini dari DOM —
     melepas elemen yang sedang fokus bisa ikut memicu blur. Ref menjaga
     `onSelesai` hanya dipanggil sekali, bukan dua kali dengan nilai sama. */
  const kirim = useRef(false);

  const tutup = () => {
    if (kirim.current) return;
    kirim.current = true;
    onSelesai(rapikanCatatan(draft));
  };

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={tutup}
      onKeyDown={(e) => {
        /* Enter menutup, bukan memsplit baris: kasir sedang mengisi satu
           catatan, bukan menulis daftar. */
        if (e.key === "Enter") {
          e.preventDefault();
          tutup();
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
    />
  );
}
