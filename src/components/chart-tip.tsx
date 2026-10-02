import type { ReactNode } from "react";

import { rupiah } from "@/lib/format";

/* ==========================================================================
   Tooltip chart.

   Recharts punya tooltip bawaan yang warnanya hardcode (latar putih, teks
   abu-abu pucat, nilai mengikuti warna seri). Di dark mode hasilnya kotak
   putih menyilaukan dengan tulisan nyaris tak terlihat; di light mode nilai
   berwarna hijau muda di atas putih — kontrasnya di bawah batas baca.

   Jadi semua tooltip memakai komponen ini, yang warnanya ikut CSS variable
   tema: bg-card, border-border, text-foreground. Gelap terang sama-sama
   terbaca tanpa perlu dua set warna.
   ========================================================================== */

type Item = {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
};

export type ChartTipProps = {
  active?: boolean;
  payload?: Item[];
  label?: string | number;
  /** Label sumbu Y, mis. "jam" atau "tanggal". */
  kind?: string;
  /** Format nilai. Default rupiah. */
  format?: (v: number) => string;
  /** Baris tambahan di bawah nilai utama, mis. jumlah transaksi. */
  sub?: ReactNode;
};

export function ChartTip({
  active,
  payload,
  label,
  kind,
  format = rupiah,
  sub,
}: ChartTipProps) {
  if (!active || !payload?.length) return null;
  // Hanya seri pertama (omset) supaya tooltip tidak mengulang angka yang sama
  // kalau sebuah Area/Bar punya lebih dari satu dataKey.
  const item = payload[0];
  const nilai = Number(item?.value ?? 0);
  const tambahan = sub ?? formatTambahan(item?.payload);
  /* Kalau titik datanya membawa tanggal ISO, tampilkan tanggal lengkap.
     Label sumbu X sengaja dipadatkan ("5", "5 Sep") supaya muat di sumbu,
     dan angka itu sendirian tidak selalu cukup — "5" di grafik 90 hari bisa
     5 Agustus atau 5 September. */
  const tanggal = typeof item?.payload?.tanggal === "string" ? tanggalPanjang(item.payload.tanggal) : null;
  const judul = tanggal ?? (kind ? `${kind} ${label}` : label);

  return (
    /* `max-w` + `break-words`: di mobile nama metode atau tanggal yang
       panjang membuat tooltip lebih lebar dari kartu, dan karena
       Recharts menaruhnya di dalam wrapper chart, tooltip keluar melewati
       tepi kartu lalu terpotong oleh `overflow-hidden` card body. Nilai
       rupiah juga bisa panjang ("Rp 2.725.500") — lebih dari lebar kartu
       di layar sempit. */
    <div className="max-w-[min(15rem,80vw)] rounded-2xl border border-border bg-card px-4 py-3 shadow-pop">
      <div className="break-words text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {judul}
      </div>
      <div className="mt-1 break-words text-lg font-bold tracking-tight text-foreground figure">
        {format(nilai)}
      </div>
      {tambahan ? (
        <div className="break-words text-xs text-muted-foreground figure">{tambahan}</div>
      ) : null}
    </div>
  );
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "2026-09-05" → "5 September 2026". */
function tanggalPanjang(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}`;
}

/* "44 transaksi" muncul otomatis kalau titik data punya kolom transaksi —
   supaya angka tambahan tidak harus ditulis ulang di tiap chart. */
function formatTambahan(payload: Record<string, unknown> | undefined): string {
  const t = payload?.transaksi;
  return typeof t === "number" ? `${t} transaksi` : "";
}
