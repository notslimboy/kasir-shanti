import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartBox } from "@/components/chart-box";
import { ChartDonut, type MetodePembayaran } from "@/components/chart-donut";
import { CHART_ANIM } from "@/components/chart-motion";
import { ChartTip } from "@/components/chart-tip";
import { BadgeBank } from "@/components/itsfood-bank";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { Toast, useToast } from "@/components/ui/toast";
import { getAccessToken } from "@/supabase/client";
import {
  LABEL_PERIODE_REKAP,
  isoDari,
  omzetDuaPeriodeDari,
  rekapPeriodeDari,
  tanggalPendekItsfood,
  trenOmzetHarian,
  type ItsfoodBill,
  type ItsfoodBillable,
  type ItsfoodPaymentHistory,
  type PeriodeRekap,
} from "@/lib/itsfood";
import { rupiah, rupiahShort } from "@/lib/format";
import { dgnCacheKlien } from "@/lib/itsfood-api";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Dashboard Itsfood (/itsfood-dashboard) — ringkasan penting, gaya
   Beranda: baris KpiCard, chart tren besar, donut komposisi, lalu
   pembayaran terakhir. Sumber data sama dengan halaman Tagihan (satu
   endpoint), hanya porsinya yang diringkas.

   Dasar bucket tanggal (konsisten dengan rekap lainnya):
     billables → deliveryDate · bills → createdAt · history → paidDate
   ========================================================================== */

const PERIODE: PeriodeRekap[] = ["hari", "7hari", "bulan"];
const HARI_TREN = [7, 30] as const;

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
    <path d={d} />
  </svg>
);
const IcoTag = ico("M3 12V4h8l9 9-8 8-9-9ZM7.5 7.5h.01");
const IcoBill = ico("M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5L6 21V3ZM9 8h6M9 12h6");
const IcoClock = ico("M12 8v4l3 3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z");
const IcoCheck = ico("M9 12l2 2 4-5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z");

/* Sumbu Y mengikuti besaran angka — "2,5 jt", bukan "2500000.0". */
function ringkasTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)} jt`;
  if (v >= 1_000) return `${Math.round(v / 1_000)} rb`;
  return String(v);
}

interface DataPayments {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
}

async function apiPayments(paksa = false): Promise<DataPayments> {
  return dgnCacheKlien(
    "payments",
    async () => {
      const res = await fetch("/api/itsfood/payments", {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return {
        billables: json.billables as ItsfoodBillable[],
        bills: json.bills as ItsfoodBill[],
        history: json.history as ItsfoodPaymentHistory[],
      };
    },
    { paksa },
  );
}

export function ItsfoodDashboardPage() {
  const nav = useNavigate();
  const [data, setData] = useState<DataPayments | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState("");
  const [periode, setPeriode] = useState<PeriodeRekap>("bulan");
  const [hariTren, setHariTren] = useState<(typeof HARI_TREN)[number]>(30);
  const [toast] = useToast();

  const muat = useCallback(async (paksa = false) => {
    setMemuat(true);
    setGalat("");
    try {
      setData(await apiPayments(paksa));
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat data pembayaran");
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  const hariIni = isoDari(new Date());

  /* KPI periode + delta omzet vs periode sebelumnya (sepanjang sama). */
  const kpi = useMemo(() => {
    if (!data) return null;
    const rekap = rekapPeriodeDari(data.billables, data.bills, data.history, periode, hariIni);
    const { kini, lalu } = omzetDuaPeriodeDari(data.billables, data.bills, data.history, periode, hariIni);
    const delta = lalu > 0 ? ((kini - lalu) / lalu) * 100 : undefined;
    return { rekap, delta };
  }, [data, periode, hariIni]);

  const tren = useMemo(
    () =>
      data ? trenOmzetHarian(data.billables, data.bills, data.history, hariIni, hariTren) : [],
    [data, hariIni, hariTren],
  );

  /* Donut komposisi omzet dalam periode terpilih. */
  const komposisi = useMemo<MetodePembayaran[]>(() => {
    if (!kpi) return [];
    const { omzet, bisaDitagih, prosesPembayaran, sudahDibayar } = kpi.rekap;
    if (omzet === 0) return [];
    return [
      { name: "Sudah Dibayar", total: sudahDibayar, pct: Math.round((sudahDibayar / omzet) * 100) },
      { name: "Proses Pembayaran", total: prosesPembayaran, pct: Math.round((prosesPembayaran / omzet) * 100) },
      { name: "Bisa Ditagih", total: bisaDitagih, pct: Math.round((bisaDitagih / omzet) * 100) },
    ].filter((x) => x.total > 0);
  }, [kpi]);

  const pembayaranTerakhir = useMemo(
    () => (data ? [...data.history].sort((a, b) => b.paidDate.localeCompare(a.paidDate)).slice(0, 6) : []),
    [data],
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      {/* Header + filter periode — gaya beranda: baris KPI di paling atas. */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Omzet & pembayaran — portal supplier ITSfood
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-muted p-1">
            {PERIODE.map((p) => (
              <button
                key={p}
                onClick={() => setPeriode(p)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  periode === p
                    ? "bg-card text-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {LABEL_PERIODE_REKAP[p]}
              </button>
            ))}
          </div>
          <button
            onClick={() => void muat(true)}
            className="h-9 rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            {memuat ? "Memuat..." : "Muat ulang"}
          </button>
        </div>
      </div>

      {galat && (
        <div className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {galat}
        </div>
      )}

      {/* KPI row — urutan & varian aktif mengikuti Beranda: kartu pertama
          forest-deep, sisanya surface. Delta hanya di Omzet. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={`Omzet · ${LABEL_PERIODE_REKAP[periode]}`}
          value={rupiah(kpi?.rekap.omzet ?? 0)}
          delta={kpi?.delta}
          active
          icon={IcoTag}
        />
        <KpiCard
          label="Bisa Ditagih"
          value={rupiah(kpi?.rekap.bisaDitagih ?? 0)}
          sub={`${kpi?.rekap.nBillables ?? 0} order`}
          icon={IcoBill}
        />
        <KpiCard
          label="Proses Pembayaran"
          value={rupiah(kpi?.rekap.prosesPembayaran ?? 0)}
          sub={`${kpi?.rekap.nBills ?? 0} tagihan`}
          icon={IcoClock}
        />
        <KpiCard
          label="Sudah Dibayar"
          value={rupiah(kpi?.rekap.sudahDibayar ?? 0)}
          sub={`${kpi?.rekap.nHistory ?? 0} pembayaran`}
          icon={IcoCheck}
        />
      </div>

      {/* Chart besar (2/3) + donut (1/3) — layout referensi. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          fillBody
          /* min-h wajib di layar sempit: mode fill mengukur tinggi kartu,
             dan kartu tanpa isi ber-TINGGI-NOL di layout tumpuk — persis
             alasan yang sama dengan kartu Tren di Beranda. */
          className="min-h-[300px] sm:min-h-[360px]"
          title={<CardTitle>Tren Omzet</CardTitle>}
          action={
            <div className="flex gap-1 rounded-full bg-muted p-1">
              {HARI_TREN.map((h) => (
                <button
                  key={h}
                  onClick={() => setHariTren(h)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    hariTren === h
                      ? "bg-card text-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {h} hari
                </button>
              ))}
            </div>
          }
        >
          <ChartBox fill>
            {(w, h) => {
              const sempit = w < 420;
              return (
                <AreaChart
                  width={w}
                  height={h}
                  data={tren}
                  margin={{ top: 8, right: 8, left: sempit ? 0 : -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="gOmzetItsfood" x1="0" y1="0" x2="0" y2="1">
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
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={ringkasTick}
                  />
                  <Tooltip
                    content={<ChartTip kind="Tanggal" />}
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="omzet"
                    stroke="var(--chart-3)"
                    strokeWidth={3}
                    fill="url(#gOmzetItsfood)"
                    {...CHART_ANIM}
                  />
                </AreaChart>
              );
            }}
          </ChartBox>
        </Card>

        <Card
          title={
            <CardTitle>
              Komposisi Omzet{" "}
              <span className="text-xs font-medium text-muted-foreground">
                · {LABEL_PERIODE_REKAP[periode]}
              </span>
            </CardTitle>
          }
        >
          {komposisi.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Belum ada omzet di periode ini.
            </p>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <ChartDonut data={komposisi} />
              <ul className="w-full space-y-2 text-sm">
                {komposisi.map((k) => (
                  <li key={k.name} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--chart-3)]" />
                      <span className="min-w-0 truncate text-muted-foreground">{k.name}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {rupiahShort(k.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* Pembayaran terakhir — pengganti "Struk Terbaru" di beranda. */}
      <Card
        title={<CardTitle>Pembayaran Terakhir</CardTitle>}
        action={
          <button
            onClick={() => nav("/itsfood-tagihan")}
            className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Lihat Semua
          </button>
        }
      >
        {pembayaranTerakhir.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada pembayaran masuk.
          </p>
        ) : (
          <ul>
            {pembayaranTerakhir.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 border-b border-[#EEF4DE] py-2.5 last:border-b-0 dark:border-border/60"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {tanggalPendekItsfood(h.paidDate)}
                    </p>
                    {h.bank && <BadgeBank bank={h.bank} />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {h.orderIds.length} order lunas
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {rupiah(h.totalValue)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Toast toast={toast} />
    </div>
  );
}
