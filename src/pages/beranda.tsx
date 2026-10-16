import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { KpiCard } from "@/components/kpi-card";
import { useData } from "@/lib/data-source";
import { Card, CardTitle, Pill } from "@/components/ui/card";
import { TeksPotong } from "@/components/ui/tooltip";
import { ChartBox } from "@/components/chart-box";
import { ChartDonut } from "@/components/chart-donut";
import { CHART_ANIM } from "@/components/chart-motion";
import { rupiah, rupiahShort } from "@/lib/format";
import {
  menuTerlarisDari,
  pelangganFavoritDari,
  ringkasanDari,
  type Ringkasan,
} from "@/lib/ringkasan";
import { grupPerKurir, petaTag, rekapOngkirPerKurir } from "@/lib/kurir";
import { KurirCard } from "@/components/kurir-card";
import { ChartTip } from "@/components/chart-tip";
import { ongkirDari, tanggalISODari } from "@/lib/live-mappers";
import type { Sale } from "@/lib/sale";

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
    <path d={d} />
  </svg>
);
const IcoTag = ico("M3 12V4h8l9 9-8 8-9-9ZM7.5 7.5h.01");
const IcoPercent = ico("M6 18 18 6M8 8.5A1.5 1.5 0 1 0 8 5.5a1.5 1.5 0 0 0 0 3ZM16 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z");
const IcoReceipt = ico("M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5L6 21V3ZM9 8h6M9 12h6");
const IcoWallet = ico("M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 3-3h10");

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/* Opsi rentang grafik tren. 7 hari untuk melihat pekan ini, 90 untuk
   membandingkan dengan bulan lalu. */
const HARI_TREN = [7, 30, 90] as const;

export function Beranda() {
  const live = useData();
  const [hariTren, setHariTren] = useState<(typeof HARI_TREN)[number]>(30);

  /* Angka kartu berasal dari sales yang dimuat. Kalau Supabase belum
     terbaca, angka dummy tetap tampil DAN lencana di topbar mengatakannya —
     tidak ada keadaan diam-diam memakai data contoh. */
  /* "Hari ini" = hari kalender di zona waktu kasir. bukan
     new Date().toISOString() (itu UTC, jadi setelah jam 17.00 WIB sudah
     besok), dan bukan tanggal struk pertama/terakhir — itu hanya kebetulan
     kebenarannya. */
  const hariIni = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }, []);

  const r: Ringkasan | null = useMemo(
    () => (live.salesSemua.length > 0 ? ringkasanDari(live.salesSemua, hariIni, hariTren) : null),
    [live.salesSemua, hariIni, hariTren],
  );

  /* Kartu Beranda memakai ringkasStruk (30 hari + sale_items), bukan
     struk yang sedang difilter di halaman Penjualan. */
  const terlaris = useMemo(() => menuTerlarisDari(live.ringkasStruk, 6), [live.ringkasStruk]);
  /* Enam, dan eksplisit. Default `pelangganFavoritDari` adalah lima, jadi
   mengandalkan defaultnya membuat kartu diam-diam melambat satu baris tanpa
   ada yang membandingkan dengan harapan. */
  const favorit = useMemo(() => pelangganFavoritDari(live.customers, 6), [live.customers]);
  const strukTerbaru: Sale[] = live.ringkasStruk.slice(0, 8);
  /* Ongkir per kurir. Kolom kurir tidak ada di tabel sales — yang ada
     customers.tag (area/franchise), dan itu yang dipetakan, persis seperti
     script.js lama. Sumber tag: petaTag dari daftar customers. */
  const ongkir = useMemo(() => {
    const tagUntukNama = petaTag(live.customers.map((c) => ({ name: c.name, tag: c.tag })));
    const rekap = rekapOngkirPerKurir(
      live.salesSemua.map((x) => ({
        ongkir: ongkirDari(x),
        customerName: x.customer_name ?? "",
        statusTerhapus: Boolean(x.deleted_at),
        tanggal: tanggalISODari(x),
      })),
      tagUntukNama,
    );
    return { ...rekap, grup: grupPerKurir(rekap.rows) };
  }, [live.salesSemua, live.customers]);

  return (
    <>

          {/* KPI row — 2x2 sejak mobile. Kalau 1 kolom, 4 kartu jadi
              648px lebih tinggi sebelum isi halaman kelihatan. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiCard active label="Omset Hari Ini" value={rupiah(r?.hariIni.omset ?? 0)}
              delta={r?.bandingHariIni?.persen}
              sub={`${r?.hariIni.transaksi ?? 0} transaksi`} icon={IcoTag} />
            <KpiCard label="Omset Bulan Ini" value={rupiahShort(r?.bulanIni.omset ?? 0)}
              delta={r?.bandingBulanIni?.persen}
              sub={`${r?.bulanIni.transaksi ?? 0} transaksi`} icon={IcoPercent} />
            <KpiCard label="Omset Minggu Ini" value={rupiahShort(r?.mingguIni.omset ?? 0)}
              delta={r?.bandingMingguIni?.persen}
              sub={`${r?.mingguIni.transaksi ?? 0} transaksi`} icon={IcoWallet} />
            <KpiCard label="Piutang Belum Lunas" value={rupiahShort(r?.piutang.nominal ?? 0)}
              sub={`${r?.piutang.count ?? 0} struk belum lunas`} icon={IcoReceipt} />
          </div>

          {/* Chart + kolom kanan */}
          <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card
              fillBody
              className="min-h-[300px] sm:min-h-[360px]"
              title={<CardTitle className="text-sm sm:text-base">Tren {hariTren} hari</CardTitle>}
              action={
                /* Tombol yang tidak melakukan apa-apa lebih buruk daripada
                   tidak ada tombolnya, jadi ini pengatur rentang sungguhan.

                   Ukurannya mengecil di bawah `sm`: dengan ukuran desktop,
                   "Tren 30 hari" + tiga tombol tidak muat sebaris di 390px
                   dan tombolnya turun ke baris kedua — justru di layar yang
                   paling sering dipakai. */
                <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border p-0.5 sm:gap-1">
                  {HARI_TREN.map((h) => (
                    <button
                      key={h}
                      onClick={() => setHariTren(h)}
                      aria-pressed={hariTren === h}
                      className={
                        "h-7 rounded-full px-2 text-[11px] font-semibold transition-colors sm:h-8 sm:px-2.5 sm:text-xs " +
                        (hariTren === h
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground")
                      }
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              }
            >
              <ChartBox fill>
                {(w, h) => {
                  /* Di layar sempit sumbu Y dan jumlah tick X memakan
                     sebagian besar lebar chart. Lebar axes dan jarak tick
                     ikut mengikuti lebar yang benar-benar tersedia. */
                  const sempit = w < 420;
                  return (
                    <AreaChart
                      width={w}
                      height={h}
                      data={r?.tren ?? []}
                      margin={{ top: 8, right: 8, left: sempit ? 0 : -18, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="gOmset" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
                      <XAxis
                        dataKey="d"
                        tickLine={false}
                        axisLine={false}
                        interval={sempit ? 7 : 4}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={sempit ? 40 : 56}
                        tickCount={sempit ? 4 : 6}
                        domain={[0, 5_000_000]}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(1)} jt`}
                      />
                      <Tooltip
                        content={<ChartTip kind="Tanggal" />}
                        cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="omset"
                        stroke="var(--chart-3)"
                        strokeWidth={3}
                        fill="url(#gOmset)"
                        {...CHART_ANIM}
                        activeDot={{ r: 6, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 3 }}
                      />
                    </AreaChart>
                  );
                }}
              </ChartBox>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Card title="Metode Pembayaran">
                {/* Donut dan daftar metode berbagi lebar, bukan donut
                    dikunci 132px. Di kartu sempit (mobile/tablet) donut
                    menyusut sesuai ruang yang tersisa; `xl:grid-cols-1`
                    membuat keduanya turun ke baris sendiri di lebar penuh
                    supaya daftar tidak tergencet. */}
                <div className="flex min-w-0 items-center gap-4 sm:gap-5">
                  <ChartDonut data={r?.metodePembayaran ?? []} />
                  <ul className="min-w-0 flex-1 space-y-2">
                    {(r?.metodePembayaran ?? []).map((m, i) => (
                      <li key={m.name} className="flex items-center gap-2 text-sm">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CHART[i % CHART.length] }} />
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span className="font-semibold figure">{m.pct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              <Card title="Ongkir per Kurir">
                <KurirCard
                  kurir={ongkir.grup}
                  total={ongkir.total}
                  rentang={ongkir.rentangAwal ? `${ongkir.rentangAwal} → ${ongkir.rentangAkhir}` : "seluruh periode"}
                />
              </Card>
            </div>
          </div>

          {/* Baris bawah */}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card title="Menu Terlaris">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-8 pb-2 font-semibold">#</th>
                    <th className="pb-2 font-semibold">Menu</th>
                    <th className="pb-2 text-right font-semibold">Terjual</th>
                    <th className="pb-2 text-right font-semibold">Omset</th>
                  </tr>
                </thead>
                <tbody>
                  {terlaris.map((m) => (
                    <tr key={m.rank} className="border-b border-border last:border-0">
                      <td className="py-2.5 text-muted-foreground figure">{m.rank}</td>
                      <td className="py-2.5 font-medium">{m.name}</td>
                      <td className="py-2.5 text-right figure">{m.qty}</td>
                      <td className="py-2.5 text-right font-semibold figure">{rupiahShort(m.omset)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Pelanggan Favorit">
              <ul className="space-y-3">
                {favorit.map((c) => (
                  <li key={c.name} className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                      {c.name.slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.orderCount}× order · terakhir {c.lastOrder}
                      </div>
                    </div>
                    <span className="shrink-0 font-semibold figure">{rupiahShort(c.total)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Struk terbaru */}
          <Card className="mt-4" title="Struk Terbaru">
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 font-semibold">No Struk</th>
                    <th className="pb-2 font-semibold">Customer</th>
                    <th className="pb-2 font-semibold">Waktu</th>
                    <th className="pb-2 text-right font-semibold pr-5">Total</th>
                    <th className="pb-2 pl-5 font-semibold">Bayar</th>
                    <th className="pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {strukTerbaru.map((s) => (
                    <tr key={s.receiptNo} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="py-2.5 font-medium figure">{s.receiptNo}</td>
                      <td className="py-2.5 max-w-[220px] truncate">{s.customer}</td>
                      <td className="py-2.5 text-muted-foreground figure">{s.completedAt}</td>
                      <td className="py-2.5 pr-5 text-right font-semibold figure">{rupiah(s.total)}</td>
                      <td className="py-2.5 pl-5">{s.payment}</td>
                      <td className="py-2.5">
                        {s.status === "lunas" && <Pill tone="success">Lunas</Pill>}
                        {s.status === "belum" && <Pill tone="warning">Belum Lunas</Pill>}
                        {s.status === "terhapus" && <Pill tone="danger">Terhapus</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Kartu struk untuk layar < lg. Barisnya tidak bisa diketuk
                di halaman ini (Struk Terbaru memang read-only), jadi
                tanpa role="button" — harus terbaca sebagai daftar,
                bukan tombol yang tidak melakukan apa pun.

                Susunannya mengikuti kartu struk di halaman Struk: nama
                dulu, total di kanan, nomor struk di baris kedua. Nomor
                yang diratakan ke kanan di sebelah total terbaca sebagai
                milik total itu, dan tidak jelas mana yang utama.

                Waktu memakai bentuk ringkas (`completedAtShort`): bentuk
                panjang "16 Oktober 2026, 09:49" berdampingan dengan dua
                pill membuat tiap pill tertekan sampai pecah dua baris di
                320px. */}
            <ul className="space-y-2 lg:hidden">
              {strukTerbaru.map((s) => (
                <li key={s.receiptNo} className="rounded-2xl border border-border bg-card p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 text-sm font-semibold">
                      <TeksPotong teks={s.customer} />
                    </span>
                    <span className="shrink-0 text-base font-bold figure">
                      {rupiah(s.total)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground figure">
                    {s.receiptNo}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs text-muted-foreground figure">
                      {s.completedAtShort}
                    </span>
                    <Pill>{s.payment}</Pill>
                    <span className="ml-auto">
                      {s.status === "lunas" && <Pill tone="success">Lunas</Pill>}
                      {s.status === "belum" && <Pill tone="warning">Belum Lunas</Pill>}
                      {s.status === "terhapus" && <Pill tone="danger">Terhapus</Pill>}
                    </span>
                  </div>
                </li>
              ))}
              {strukTerbaru.length === 0 && (
                <li className="rounded-2xl border border-dashed border-input py-10 text-center text-sm text-muted-foreground">
                  Belum ada struk
                </li>
              )}
            </ul>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {live.status === "live"
              ? "Angka dari Supabase."
              : "Data contoh — Supabase belum terbaca."}
          </p>
    </>
  );
}
