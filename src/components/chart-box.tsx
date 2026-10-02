import { useSize } from "@/lib/use-size";

/* Wrapper chart: mengukur sendiri lalu mengoper width/height eksplisit ke Recharts.
   ResponsiveContainer Recharts 3 kadang melaporkan 0 di dalam grid/flex.

   Dua mode:
     height={260}  -> tinggi tetap, untuk chart di dalam kartu pendek
     fill           -> ikut mengikuti tinggi card. Dipakai kalau kartu berada
                       di grid yang disamakan tinggi dengan kartu sebelah,
                       supaya tidak ada ruang kosong di bawah chart.

   PENTING — kenapa mode fill memakai position:absolute, bukan height:100%.

   `height: 100%` cuma menghasilkan tinggi yang DEFINIT kalau induknya punya
   tinggi definit. Card dengan `min-h-[300px]` (semua breakpoint mobile dan
   tablet) TIDAK punya tinggi definit: `min-height` memberi batas bawah, bukan
   tinggi. Rantainya:

     Card fillBody  -> section.flex.flex-col  (tinggi = content)
       body         -> div.min-h-0.flex-1    (tinggi = sisa, tapi tidak definit)
         wrapper    -> height:100%            (resolve ke auto)
           chart    -> SVG setinggi h px     (h = tinggi wrapper terukur)
           wrapper  -> jadi h px             (loop balik, tumbuh terus)

   Di desktop kartu sebaris sering punya `h-[340px]` jadi rapi, dan loop
   itu ikut equilibrium di tinggi tetap — bug-nya tidak terlihat. Di mobile
   dan tablet yang hanya punya `min-h`, tidak ada titik equilibrium: chart
   memanjang ratusan px dan keluar dari card. Itu yang terjadi di Tren 30
   hari terakhir dan Omset harian.

   `position:absolute; inset:0` memutus loop: wrapper diposisikan relatif
   terhadap body card, sehingga `inset:0` memberi tinggi definit dari kotak
   body — yang sendiri sudah dibatasi oleh `min-h` card dan tidak dipengaruhi
   isi. Chart lalu mengisi ruang itu persis, dan hanya itu. */

export function ChartBox({
  height,
  fill = false,
  children,
  className = "",
}: {
  height?: number;
  fill?: boolean;
  children: (w: number, h: number) => React.ReactNode;
  className?: string;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const w = Math.max(0, Math.floor(size.width));
  const h = fill ? Math.max(0, Math.floor(size.height)) : (height ?? 0);
  return (
    <div
      ref={ref}
      /* absolute + inset-0 hanya untuk mode fill. Lebar tetap 100% supaya
         chart membentang penuh, tapi tingginya datang dari kotak yang
         diposisikan, bukan dari flow content — jadi tidak bisa memanjang
         sendiri. `min-w-0` mencegah wrapper melebar dari konten di dalam
         grid/flex yang lebar minimnya nol. */
      className={fill ? `absolute inset-0 min-w-0 ${className}` : `min-w-0 ${className}`}
      style={fill ? undefined : { width: "100%", height: h }}
    >
      {w > 0 && h > 0 ? children(w, h) : null}
    </div>
  );
}
