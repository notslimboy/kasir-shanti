import { useMemo } from "react";

import { StatTile, Tabs } from "@/components/ui/kit";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range";
import {
  LABEL_PERIODE_REKAP,
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

export type OpsiPeriodeRekap = PeriodeRekap | "custom";
const OPSI: OpsiPeriodeRekap[] = ["hari", "7hari", "bulan", "custom"];

export function RekapPembayaranStrip({
  billables,
  bills,
  history,
  periode,
  rentang,
  rentangDefault,
  jendela,
  onPeriodeChange,
  onRentangChange,
}: {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
  periode: OpsiPeriodeRekap;
  rentang: DateRange | null;
  rentangDefault: DateRange;
  jendela: { dari: string; sampai: string; label: string };
  onPeriodeChange: (periode: OpsiPeriodeRekap) => void;
  onRentangChange: (rentang: DateRange | null) => void;
}) {
  const hasil = useMemo(
    () => rekapRentangDari(billables, bills, history, jendela.dari, jendela.sampai),
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
          onChange={(id) => onPeriodeChange(id as OpsiPeriodeRekap)}
        />
        {periode === "custom" && (
          <DateRangePicker
            value={rentang ?? rentangDefault}
            onChange={onRentangChange}
            showPresets={false}
            align="start"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={`Omzet · ${jendela.label}`}
          value={rupiah(hasil.omzet)}
          hint="bisa ditagih + tagihan + uang masuk"
          tone="accent"
        />
        <StatTile
          label="Siap Ditagih"
          value={rupiah(hasil.bisaDitagih)}
          hint={`${hasil.nBillables} order selesai, belum ditagih`}
        />
        <StatTile
          label="Belum Terbayar"
          value={rupiah(hasil.belumTerbayar)}
          hint={`${hasil.nBelumTerbayar} tagihan belum masuk rekening Shanti`}
          tone="warn"
        />
        <StatTile
          label="Uang Masuk"
          value={rupiah(hasil.sudahDibayar)}
          hint={`${hasil.nHistory} pembayaran diterima Shanti`}
        />
      </div>
    </div>
  );
}
