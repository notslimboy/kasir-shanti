import { Cell, Pie, PieChart, Tooltip } from "recharts";

import { useSize } from "@/lib/use-size";
import { CHART_ANIM_FAST, PIE_TIP, potongNama } from "@/components/chart-motion";
import { ChartTip } from "@/components/chart-tip";

/* ==========================================================================
   Donut metode pembayaran.

   Donut ini tadinya dikunci `width={132}` hardcoded di kedua halaman. Di
   layar sempit dan tablet, kartu jadi lebih sempit dari 132px + daftar
   metode di sebelahnya, jadi flex row `items-center gap-5` mendorong isi
   melewati tepi kartu — donat terpotong dan daftar metode ikut meluber
   keluar kartu.

   Ukuran diameter sekarang datang dari CSS breakpoint, bukan dari
   angka yang ditulis di JSX:

     h-[104px] w-[104px]  -> mobile, cukup untuk donut + legenda
     sm:h-[120px]         -> tablet, ada ruang lebih
     xl:h-[132px]         -> desktop, ukuran semula

   Kenapa diukur dan bukan ditulis langsung ke <PieChart width={...}>?
   Karena ResizeObserver mengukur kotak yang.ukurannya TIDAK bergantung
   pada isi SVG — jadi tidak ada lingkaran: CSS menentukan lebar, lalu
   angka terukur dipakai untuk geometri SVG.

   Versi pertama komponen ini justru salah di sini: ia mengukur kotak
   sendiri lalu menulis `width: d` ke kotak itu. Kotak jadi mengukur
   dirinya sendiri, `d` = 0 selamanya, dan donut tidak pernah render.
   CSS-driven width memutus lingkaran itu.

   Label tengah (persentase + nama metode terbesar) ikut mengikuti
   diameter, supaya saat donut menyusut label tetap pas di tengah cincin.
   ========================================================================== */

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/* Rasio radius terhadap DIAMETER, bukan terhadap radius luar.
   Dari geometri asli (diameter 132): dalam 40, luar 62.
     dalam/d = 40/132 = 0.303
     luar/d = 62/132 = 0.470
   Kalau dalam dipakai rasio terhadap luar (40/62 = 0.645) lalu dikali
   diameter, hasilnya 0.645 * 104 = 67 — LEBIH BESAR dari luar (50).
   innerRadius > outerRadius membuat Recharts tidak menggambar arc sama
   sekali, jadi donut hilang total di semua breakpoint. */
const RASIO_DALAM = 40 / 132;
const RASIO_LUAR = 62 / 132;

export type MetodePembayaran = { name: string; total: number; pct: number };

export function ChartDonut({ data }: { data: MetodePembayaran[] }) {
  const [ref, size] = useSize<HTMLDivElement>();

  const d = Math.floor(size.width);
  const dalam = Math.round(d * RASIO_DALAM);
  const luar = Math.round(d * RASIO_LUAR);
  const cx = d / 2;
  const cy = d / 2;

  return (
    <div
      ref={ref}
      /* shrink-0: donut tidak ikut gepencet kalau daftar metode memanjang.
         Width dan height datang dari CSS, bukan dari angka terukur, supaya
         keduanya tidak bergantung pada isi SVG di dalamnya. */
      className="h-[104px] w-[104px] shrink-0 sm:h-[120px] sm:w-[120px] xl:h-[132px] xl:w-[132px]"
    >
      {d > 0 ? (
        <PieChart width={d} height={d} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Tooltip content={<ChartTip />} cursor={false} />
          <Pie
            data={data}
            dataKey="total"
            nameKey="name"
            cx={cx}
            cy={cy}
            innerRadius={dalam}
            outerRadius={luar}
            {...PIE_TIP}
            {...CHART_ANIM_FAST}
          >
            {data.map((m, i) => (
              <Cell key={m.name} fill={CHART[i % CHART.length]} />
            ))}
          </Pie>
          {/* Metode terbesar ditulis di tengah donut, supaya metode yang
              porsinya 1% tidak hilang di antara dua arc besar dan grafiknya
              tidak terlihat seperti metode yang tidak dibayar.

              Semua ukuran dan jarak ikut skala diameter. Offset `cy-4` /
              `cy+11` yang tetap akan menumpuk dan keluar dari cincin di
              donut terkecil (dalam = 32px di d=104), karena dua baris
              dengan font 13px butuh tinggi lebih dari diameter dalam. */}
          {data[0] ? (
            <>
              <text
                x={cx}
                y={cy - Math.max(3, d * 0.03)}
                textAnchor="middle"
                fontSize={Math.max(12, Math.round(d * 0.115))}
                fontWeight={700}
                fill="var(--foreground)"
              >
                {data[0].pct}%
              </text>
              <text
                x={cx}
                y={cy + Math.max(8, d * 0.083)}
                textAnchor="middle"
                fontSize={Math.max(8, Math.round(d * 0.068))}
                fill="var(--muted-foreground)"
              >
                {potongNama(data[0].name)}
              </text>
            </>
          ) : null}
        </PieChart>
      ) : null}
    </div>
  );
}
