import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/* ==========================================================================
   Header tabel yang bisa diurutkan.

   Setiap kolom yang punya urutan alami (nomor, nama, tanggal, angka) bisa
   diklik untuk mengubah arahnya: naik -> turun -> kembali ke urutan asli.

   Kenapa ada tahap "kembali ke urutan asli" dan bukan sekadar toggle
   naik/turun? Karena urutan bawaan itu bukan acak. Tabel struk sudah
   terurut dari yang paling baru, dan struk paling baru justru yang
   dicari lebih sering. Tahap ketiga mengembalikan tampilan ke kondisi
   paling berguna, jadi "klik sekali lagi" punya tujuan yang jelas,
   bukan asal berubah.

   Arah naik = A ke Z, angka kecil ke besar, tanggal lama ke baru.
   */

export type Arah = "asc" | "desc";
export type Urutan = { kolom: string; arah: Arah } | null;

/** Klik kolom yang sama: naik -> turun -> lepas (urutan asli). */
export function arahBerikutnya(urut: Urutan, kolom: string): Urutan {
  if (urut?.kolom !== kolom) return { kolom, arah: "asc" };
  if (urut.arah === "asc") return { kolom, arah: "desc" };
  return null;
}

/**
 * Bandingkan satu kolom.
 *
 * `nilai` mengembalikan nilai yang sudah dinormalisasi ke tipe yang bisa
 * dibandingkan:
 *   - angka -> Number (total, qty, ongkir)
 *   - teks  -> String, dibandingkan dengan localeCompare "id-ID" supaya
 *              urutan hurufnya mengikuti kaidah bahasa Indonesia
 *   - waktu -> Date.parse, bukan string. completedAt sudah diformat
 *              "30 Sep 2026 14.05" untuk dibaca manusia; mengurutkan
 *              string itu berarti "14.05" dianggap lebih besar dari
 *              "09.30" karena perbandingan karakter, bukan waktu.
 *
 * Nilai kosong dianggap paling akhir supaya baris yang datanya belum ada
 * tidak menduduki posisi pertama saat urutan naik.
 */
function bandingkan(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), "id-ID");
}

/**
 * Terapkan pengurutan pada salinan array (tidak mengubah aslinya).
 *
 * `nilai` menerjemahkan satu baris menjadi nilai kolom yang diurutkan.
 * Kalau tidak ada `urutan`, baris dikembalikan apa adanya, dan itulah
 * yang membuat tahap "lepas" tersebut berguna.
 *
 * Baris yang nilainya kosong dipisahkan DULU, sebelum arah diterapkan.
 * Kalau pembanding null ikut dibalik seperti yang lain, menekan Turun
 * akan membuat baris kosong melompat ke posisi paling atas — dan baris
 * yang datanya belum ada tidak pernah punya alasan untuk dibaca lebih
 * dulu. "Turun" harus tetap menampilkan data terbaik lebih dulu, dengan
 * yang kosong sebagai ekornya.
 */
export function urutkan<T>(
  baris: readonly T[],
  urutan: Urutan,
  nilai: (baris: T, kolom: string) => unknown,
): T[] {
  if (!urutan) return baris.slice();
  const arah = urutan.arah === "asc" ? 1 : -1;
  return baris
    .slice()
    .sort((a, b) => {
      const va = nilai(a, urutan.kolom);
      const vb = nilai(b, urutan.kolom);
      const ka = va == null;
      const kb = vb == null;
      if (ka !== kb) return ka ? 1 : -1;
      return arah * bandingkan(va, vb);
    });
}

export function useUrutan() {
  const [urutan, setUrutan] = useState<Urutan>(null);
  const toggle = useCallback((kolom: string) => setUrutan((u) => arahBerikutnya(u, kolom)), []);
  return { urutan, toggle } as const;
}

/**
 * Header yang bisa diklik.
 *
 * Tombolnya membungkus label dan panah supaya area kliknya besar, bukan
 * cuma teks 11px. `aria-sort` memberi kabar ke screen reader, karena
 * sorting visual saja tanpa pengumuman berarti tabel ini tidak bisa
 * difahami pembaca tanpa melihat.
 */
export function SortableTh({
  kolom,
  urutan,
  onToggle,
  children,
  className,
  align = "left",
}: {
  kolom: string;
  urutan: Urutan;
  onToggle: (kolom: string) => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const aktif = urutan?.kolom === kolom;
  return (
    <th
      scope="col"
      aria-sort={aktif ? (urutan?.arah === "asc" ? "ascending" : "descending") : "none"}
      className={cn("pb-2 font-semibold", align === "right" ? "text-right" : "text-left", className)}
    >
      <button
        type="button"
        onClick={() => onToggle(kolom)}
        className={cn(
          "group -mb-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          // Kalau sedang aktif, label jadi teks normal. Kalau tidak, tetap
          // redup seperti header lain supaya tidak semua kolom terlihat
          // bisa diklik.
          aktif ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{children}</span>
        <span
          aria-hidden="true"
          className={cn(
            "text-[10px] leading-none transition-opacity",
            aktif ? "opacity-100" : "opacity-0 group-hover:opacity-40",
          )}
        >
          {aktif ? (urutan?.arah === "asc" ? "▲" : "▼") : "▼"}
        </span>
      </button>
    </th>
  );
}

/** Kotak pencarian tabel. */
export function TableSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 items-center gap-2 rounded-full border border-border bg-background px-3",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      >
        <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}