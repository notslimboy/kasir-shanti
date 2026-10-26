import { useMemo, useState } from "react";

import { StatTile, Tabs } from "@/components/ui/kit";
import { DateRangePicker, labelRentang, type DateRange } from "@/components/ui/date-range";
import {
  LABEL_PERIODE_REKAP,
  isoDari,
  rekapRentangDari,
  type PeriodeRekap,
  type ItsfoodBill,
  type ItsfoodBillable,
  type ItsfoodPaymentHistory,
} from "@/lib/itsfood";
import { rupiah } from "@/lib/format";

/* ==========================================================================
   RekapPembayaranStrip — 4 StatTile pembayaran itsfood + filter periode.

   Dipakai di halaman Tagihan. Halaman Dashboard Itsfood memakai KpiCard
   beranda-style dengan helper periode yang sama dari lib/itsfood.ts —
   jadi angka antar halaman dihitung oleh kode yang sama.

   Dasar tanggal per bucket (kapan nilai masuk keranjang itu):
     - Bisa Ditagih        → deliveryDate (jasa selesai dikerjakan)
     - Proses Pembayaran   → createdAt bill (tagihan dibuat)
     - Sudah Dibayar       → paidDate (uang masuk)

   Mekanisme Custom mengikuti dashboard Penjualan: preset memilih
   rentang tetap, Custom membuka DateRangePicker (komponen tangan, bukan
   widget native — DESIGN.md §8).
   ========================================================================== */

type Opsi = PeriodeRekap | "custom";
const OPSI: Opsi[] = ["hari", "7hari", "bulan", "custom"];

export function RekapPembayaranStrip({
  billables,
  bills,
  history,
}: {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
}) {
  const [periode, setPeriode] = useState<Opsi>("bulan");
  const [rentang, setRentang] = useState<DateRange | null>(null);
  const hariIni = isoDari(new Date());

  const jendela = useMemo<{ dari: string; sampai: string; label: string } | null>(() => {
    if (periode === "custom") {
      if (!rentang) return null;
      return {
        dari: isoDari(rentang.from),
        sampai: isoDari(rentang.to),
        label: labelRentang(rentang),
      };
    }
    const d = new Date(hariIni);
    if (periode === "7hari") d.setDate(d.getDate() - 6);
    if (periode === "bulan") d.setDate(1);
    return { dari: isoDari(d), sampai: hariIni, label: LABEL_PERIODE_REKAP[periode] };
  }, [periode, rentang, hariIni]);

  const hasil = useMemo(
    () =>
      jendela
        ? rekapRentangDari(billables, bills, history, jendela.dari, jendela.sampai)
        : null,
    [billables, bills, history, jendela],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Filter periode — komponen Tabs yang sama dengan Penjualan. */}
        <Tabs
          items={OPSI.map((p) => ({
            id: p,
            label: p === "custom" ? "Custom" : LABEL_PERIODE_REKAP[p],
          }))}
          value={periode}
          onChange={(id) => {
            const p = id as Opsi;
            setPeriode(p);
            // Masuk Custom tanpa rentang: mulai dari 7 hari terakhir,
            // jadi angka langsung ada dan picker tinggal dipakai mengubah.
            if (p === "custom" && !rentang) {
              const d = new Date(hariIni);
              d.setDate(d.getDate() - 6);
              setRentang({ from: d, to: new Date(hariIni) });
            }
          }}
        />
        {periode === "custom" && (
          <DateRangePicker
            value={rentang}
            onChange={setRentang}
            showPresets={false}
            align="start"
          />
        )}
      </div>

      {!hasil || !jendela ? (
        <p className="py-2 text-center text-sm text-muted-foreground">
          Pilih rentang untuk melihat rekap.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={`Omzet · ${jendela.label}`}
            value={rupiah(hasil.omzet)}
            hint="tagihan + terbayar"
            tone="accent"
          />
          <StatTile
            label="Bisa Ditagih"
            value={rupiah(hasil.bisaDitagih)}
            hint={`${hasil.nBillables} order`}
          />
          <StatTile
            label="Proses Pembayaran"
            value={rupiah(hasil.prosesPembayaran)}
            hint={`${hasil.nBills} tagihan belum lunas`}
            tone="warn"
          />
          <StatTile
            label="Sudah Dibayar"
            value={rupiah(hasil.sudahDibayar)}
            hint={`${hasil.nHistory} pembayaran`}
          />
        </div>
      )}
    </div>
  );
}
