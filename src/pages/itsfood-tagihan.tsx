import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, Pill } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Toast, useToast } from "@/components/ui/toast";
import { Memuat } from "@/components/ui/memuat";
import { PageHeader, Tabs } from "@/components/ui/kit";
import { RekapPembayaranStrip } from "@/components/itsfood-rekap";
import { BadgeBank } from "@/components/itsfood-bank";
import {
  SortableTh,
  TableSearch,
  urutkan,
  useUrutan,
} from "@/components/ui/sortable-table";
import { getAccessToken } from "@/supabase/client";
import type {
  ItsfoodBillable,
  ItsfoodBill,
  ItsfoodPaymentDetail,
  ItsfoodPaymentHistory,
  RekapPembayaran,
} from "@/lib/itsfood";
import {
  labelStatusBill,
  tanggalJamPendek,
  tanggalPendekItsfood,
} from "@/lib/itsfood";
import { rupiah } from "@/lib/format";
import { bacaCacheKlien, dgnCacheKlien, kosongkanCacheKlien } from "@/lib/itsfood-api";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Itsfood — Tagihan & Omzet (/itsfood-tagihan).

   Mirror dari tiga halaman payments portal dalam satu halaman:
     Bisa Ditagih  → order selesai, tagihan belum dibuat (+ aksi makeBill)
     Bills         → tagihan dibuat, belum dibayar (pending)
     Sudah Dibayar → history pembayaran masuk

   Struktur mengikuti halaman Penjualan: PageHeader → kartu rekap
   (StatTile + filter periode) → Tabs daftar → konten. Angka rupiah
   portal ("Rp. 1,770,000") tetap verbatim di tabel daftar (itu nilai
   dokumen), rekap yang diformat rupiah() app.
   ========================================================================== */

type Tab = "billables" | "bills" | "history";

interface DataPayments {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
  /** Diturunkan di klien, tidak di-cache: bentuk cache "payments" harus
      sama dengan halaman lain (daftar mentah saja). */
  rekap?: RekapPembayaran;
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
        rekap: json.rekap as RekapPembayaran,
      };
    },
    { paksa },
  );
}

async function apiMakeBill(orderId: string): Promise<{ sukses: boolean; pesan: string }> {
  const res = await fetch("/api/itsfood/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken() ?? ""}`,
    },
    body: JSON.stringify({ orderId }),
  });
  const json = await res.json().catch(() => null);
  return json ?? { sukses: false, pesan: "Respon tidak terbaca" };
}

async function apiDetailPayment(paymentId: string): Promise<ItsfoodPaymentDetail> {
  const res = await fetch(`/api/itsfood/payments?id=${paymentId}`, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json.detail as ItsfoodPaymentDetail;
}

export function ItsfoodTagihanPage() {
  const [tab, setTab] = useState<Tab>("billables");
  const [data, setData] = useState<DataPayments | null>(
    () => bacaCacheKlien<DataPayments>("payments") ?? null,
  );
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState("");
  const [konfirmasi, setKonfirmasi] = useState<ItsfoodBillable | null>(null);
  const [memproses, setMemproses] = useState(false);
  /* Detail pembayaran (modal) — diload saat baris history diklik. */
  const [detail, setDetail] = useState<ItsfoodPaymentDetail | null>(null);
  const [detailMemuat, setDetailMemuat] = useState(false);
  const [toast, setToast] = useToast();

  const muat = useCallback(async (paksa = false) => {
    setGalat("");
    /* Cache segar = langsung tampil, tanpa spinner. */
    if (!paksa) {
      const cached = bacaCacheKlien<DataPayments>("payments");
      if (cached) {
        setData(cached);
        setMemuat(false);
        return;
      }
    }
    setMemuat(true);
    setToast({
      tone: "info",
      spin: true,
      text: "Memuat tagihan & pembayaran dari portal…",
    });
    try {
      setData(await apiPayments(paksa));
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat data pembayaran");
    } finally {
      setMemuat(false);
      setToast(null);
    }
  }, [setToast]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function buatTagihan(b: ItsfoodBillable) {
    setMemproses(true);
    setToast({ tone: "info", spin: true, text: `Membuat tagihan order #${b.orderId}…` });
    try {
      const hasil = await apiMakeBill(b.orderId);
      setKonfirmasi(null);
      // Daftar billables & bills berubah di portal → cache basi. Pesan
      // hasil dipasang setelah muat ulang (lihat catatan di itsfood.tsx).
      kosongkanCacheKlien(["payments"]);
      await muat(true);
      setToast({ tone: hasil.sukses ? "ok" : "warn", text: hasil.pesan });
    } catch {
      setToast({ tone: "warn", text: "Gagal mengirim permintaan tagihan" });
    } finally {
      setMemproses(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHeader
        title="Tagihan & Omzet"
        sub="Rekap pembayaran dari portal supplier"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void muat(true)}
              className={cn(
                "h-10 rounded-full border border-border bg-card px-4 text-sm font-semibold",
                "text-muted-foreground transition-colors hover:border-primary hover:text-foreground",
              )}
            >
              {memuat ? "Memuat…" : "Muat ulang"}
            </button>
          </div>
        }
      />

      <Card>
        {galat ? (
          <div className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {galat}
          </div>
        ) : data ? (
          <RekapPembayaranStrip
            billables={data.billables}
            bills={data.bills}
            history={data.history}
          />
        ) : (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Memuat rekap...
          </p>
        )}
      </Card>

      <Card>
        <Tabs
          items={[
            { id: "billables", label: "Bisa Ditagih", count: data?.billables.length },
            { id: "bills", label: "Bills", count: data?.bills.length },
            { id: "history", label: "Sudah Dibayar", count: data?.history.length },
          ]}
          value={tab}
          onChange={(id) => setTab(id as Tab)}
        />

        <div className="mt-4">
          {!data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {memuat ? "Menarik data pembayaran dari portal…" : "Tidak ada data"}
            </p>
          ) : tab === "billables" ? (
            <DaftarBillables list={data.billables} onTagih={setKonfirmasi} />
          ) : tab === "bills" ? (
            <DaftarBills list={data.bills} />
          ) : (
            <DaftarHistory
              list={data.history}
              onDetail={(h) => {
                setDetail(null);
                setDetailMemuat(true);
                void apiDetailPayment(h.id)
                  .then(setDetail)
                  .catch((e) =>
                    setToast({
                      tone: "warn",
                      text: e instanceof Error ? e.message : "Detail gagal dimuat",
                    }),
                  )
                  .finally(() => setDetailMemuat(false));
              }}
            />
          )}
        </div>
      </Card>

      <Modal
        open={konfirmasi !== null}
        onClose={() => (memproses ? undefined : setKonfirmasi(null))}
        title={konfirmasi ? `Tagihkan order #${konfirmasi.orderId}?` : ""}
        subtitle={konfirmasi?.customer}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setKonfirmasi(null)}
              disabled={memproses}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Batal
            </button>
            <button
              onClick={() => konfirmasi && void buatTagihan(konfirmasi)}
              disabled={memproses}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {memproses ? "Mengirim..." : "Ya, Buat Tagihan"}
            </button>
          </div>
        }
      >
        {konfirmasi && (
          <p className="text-sm text-muted-foreground">
            Nilai{" "}
            <b className="tabular-nums text-foreground">
              {rupiah(konfirmasi.amountValue)}
            </b>{" "}
            — tagihan dibuat di portal itsfood, masuk daftar Bills dengan
            status <b className="text-foreground">Menunggu Pembayaran</b>.
          </p>
        )}
      </Modal>

      {/* Detail pembayaran — dibuka dari baris "Sudah Dibayar". */}
      <Modal
        open={detailMemuat || detail !== null}
        onClose={() => {
          setDetail(null);
          setDetailMemuat(false);
        }}
        title={detail ? `Pembayaran #${detail.id}` : "Memuat rincian pembayaran…"}
        subtitle={
          detail
            ? `${tanggalJamPendek(detail.paidDate)}${detail.bank ? ` · ${detail.bank}` : ""}`
            : undefined
        }
      >
        {detailMemuat && !detail ? (
          <Memuat teks="Memuat rincian pembayaran dari portal…" />
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatMini label="Total" value={rupiah(detail.totalValue)} />
              <StatMini label="Dibayar" value={tanggalJamPendek(detail.paidDate)} />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {detail.bills.length} order dalam pembayaran ini
              </p>
              <ul>
                {detail.bills.map((b) => (
                  <li
                    key={b.billId}
                    className="flex items-center justify-between gap-3 border-b border-[#EEF4DE] py-2 text-sm last:border-b-0 dark:border-border/60"
                  >
                    <div className="min-w-0">
                      <p className="font-bold tabular-nums">#{b.orderId}</p>
                      <p className="text-xs text-muted-foreground">
                        Antar {tanggalJamPendek(b.deliveryDate)}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {rupiah(b.payableValue)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Modal>

      <Toast toast={toast} posisi="atas-tengah" />
    </div>
  );
}

/* Angka/tanggal mini di dalam modal. */
function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background p-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paging bertahap — 30 baris dulu, sentinel di bawah menyisip 30 lagi */
/* begitu terlihat (daftar history bisa ratusan).                      */
/* ------------------------------------------------------------------ */

const TAHAP = 30;

function useTahap(total: number, resetKey?: string) {
  const [batas, setBatas] = useState(TAHAP);
  const ref = useRef<HTMLDivElement>(null);
  const selesai = batas >= total;

  // Filter/cari berubah → tampilan dari awal lagi, bukan lanjutan daftar
  // lama yang isinya sudah tidak relevan.
  useEffect(() => {
    setBatas(TAHAP);
  }, [resetKey]);

  useEffect(() => {
    if (selesai) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setBatas((b) => Math.min(b + TAHAP, total));
        }
      },
      { rootMargin: "320px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [selesai, total]);

  return { ref, terlihat: Math.min(batas, total), selesai };
}

function Sentinel({ ref, sisa }: { ref: React.RefObject<HTMLDivElement | null>; sisa: number }) {
  return (
    <div ref={ref} className="py-3 text-center text-xs text-muted-foreground">
      {sisa > 0 ? `Menampilkan berikutnya... (${sisa} lagi)` : ""}
    </div>
  );
}

/** "7 Okt 2026 · 14:49" → "14:49" kalau tanggalnya sama dengan acuan —
    dalam satu baris tagihan, tanggal yang berulang-ulang adalah noise. */
function waktuRingkas(t: string, acuan?: string): string {
  const tgl = t.slice(0, 10);
  const jam = t.slice(11, 16);
  if (acuan && tgl === acuan.slice(0, 10) && jam) return jam;
  return tanggalJamPendek(t);
}

/* ------------------------------------------------------------------ */
/* Daftar: Bisa Ditagih                                                */
/* ------------------------------------------------------------------ */

function DaftarBillables({
  list,
  onTagih,
}: {
  list: ItsfoodBillable[];
  onTagih: (b: ItsfoodBillable) => void;
}) {
  const { ref, terlihat, selesai } = useTahap(list.length);
  if (list.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Tidak ada order yang bisa ditagih sekarang.
      </p>
    );
  }
  return (
    <div>
      <ul className="space-y-2.5">
        {list.slice(0, terlihat).map((b) => (
          <li
            key={b.orderId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-border/60 bg-background p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-bold tabular-nums">#{b.orderId}</p>
              <p className="text-sm font-medium">{b.customer}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Antar {tanggalPendekItsfood(b.deliveryDate)}
                {b.purpose && <> · {b.purpose}</>}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-bold tabular-nums">
                {rupiah(b.amountValue)}
              </span>
              <button
                onClick={() => onTagih(b)}
                className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Buat Tagihan
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!selesai && <Sentinel ref={ref} sisa={list.length - terlihat} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Daftar: Bills                                                       */
/* ------------------------------------------------------------------ */

const FILTER_STATUS = [
  "semua",
  "Menunggu Pembayaran",
  "Diproses",
  "Terbayar",
] as const;

function DaftarBills({ list }: { list: ItsfoodBill[] }) {
  const { urutan, toggle } = useUrutan();
  const [cari, setCari] = useState("");
  const [status, setStatus] = useState<(typeof FILTER_STATUS)[number]>("semua");

  const tersaring = useMemo(() => {
    const q = cari.trim();
    return list.filter((b) => {
      if (q && !b.orderId.includes(q) && !b.billId.includes(q)) return false;
      if (status !== "semua" && labelStatusBill(b.status).label !== status) return false;
      return true;
    });
  }, [list, cari, status]);

  const terurut = useMemo(
    () =>
      urutkan(tersaring, urutan, (b, kolom) => {
        if (kolom === "orderId") return Number(b.orderId);
        if (kolom === "nilai") return b.receivableValue;
        if (kolom === "status") return labelStatusBill(b.status).label;
        return b.createdAt;
      }),
    [tersaring, urutan],
  );

  const { ref, terlihat, selesai } = useTahap(terurut.length, `${cari}|${status}`);

  if (list.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Tidak ada tagihan berjalan.
      </p>
    );
  }

  const jumlahStatus = (s: (typeof FILTER_STATUS)[number]) =>
    s === "semua"
      ? list.length
      : list.filter((b) => labelStatusBill(b.status).label === s).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={cari}
          onChange={setCari}
          placeholder="Cari order ID..."
          className="w-full sm:w-64"
        />
        {/* Filter status — chip, sama polanya dengan tab. */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_STATUS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                status === s
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "semua" ? "Semua" : s}
              <span className="ml-1 opacity-60 tabular-nums">{jumlahStatus(s)}</span>
            </button>
          ))}
        </div>
      </div>

      {terurut.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Tidak ada tagihan yang cocok.
        </p>
      ) : (
        <>
          {/* Tabel penuh (sm ke atas) — konvensi tabel DESIGN.md, di
              dalam wadah tint supaya barisnya tidak nyatu dengan Card. */}
          <div className="rounded-2xl bg-background px-4 py-1.5">
          <table className="hidden w-full sm:table">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                <SortableTh kolom="orderId" urutan={urutan} onToggle={toggle} className="py-2">
                  Order ID
                </SortableTh>
                <SortableTh kolom="createdAt" urutan={urutan} onToggle={toggle} className="py-2">
                  Dibuat
                </SortableTh>
                <th className="py-2 text-left font-semibold">Diproses</th>
                <th className="py-2 text-left font-semibold">Dibayar</th>
                <SortableTh kolom="nilai" urutan={urutan} onToggle={toggle} align="right" className="py-2">
                  Nilai
                </SortableTh>
                <SortableTh kolom="status" urutan={urutan} onToggle={toggle} align="right" className="py-2">
                  Status
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {terurut.slice(0, terlihat).map((b) => {
                const st = labelStatusBill(b.status);
                return (
                  <tr
                    key={b.billId}
                    className="border-b border-[#EEF4DE] text-sm last:border-b-0 dark:border-border/60"
                  >
                    <td className="py-3 font-bold tabular-nums">#{b.orderId}</td>
                    <td className="py-3 tabular-nums text-muted-foreground">
                      #{b.billId} · {tanggalJamPendek(b.createdAt)}
                    </td>
                    <td className="py-3 tabular-nums text-muted-foreground">
                      {b.processDate !== "-" ? waktuRingkas(b.processDate, b.createdAt) : "—"}
                    </td>
                    <td className="py-3 tabular-nums text-muted-foreground">
                      {b.paidDate !== "-" ? waktuRingkas(b.paidDate, b.createdAt) : "—"}
                    </td>
                    <td className="py-3 text-right font-bold tabular-nums">
                      {rupiah(b.receivableValue)}
                    </td>
                    <td className="py-3 text-right">
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* Kartu (di bawah sm) — tiap bill kartu tersendiri ber-tint:
              putih-di-putih di light mode itu yang bikin semuanya nyatu. */}
          <ul className="space-y-2.5 sm:hidden">
            {terurut.slice(0, terlihat).map((b) => {
              const st = labelStatusBill(b.status);
              return (
                <li
                  key={b.billId}
                  className="rounded-2xl border border-border/60 bg-background p-3"
                >
                  <div className="flex items-center justify-between gap-x-3">
                    <p className="text-sm font-bold tabular-nums">#{b.orderId}</p>
                    <span className="text-sm font-bold tabular-nums">
                      {rupiah(b.receivableValue)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Pill tone={st.tone}>{st.label}</Pill>
                    <span className="text-xs text-muted-foreground">
                      Tagihan #{b.billId} · dibuat {tanggalJamPendek(b.createdAt)}
                    </span>
                  </div>
                  {(b.processDate !== "-" || b.paidDate !== "-") && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {b.processDate !== "-" && (
                        <>diproses {waktuRingkas(b.processDate, b.createdAt)}</>
                      )}
                      {b.processDate !== "-" && b.paidDate !== "-" && <> · </>}
                      {b.paidDate !== "-" && (
                        <>dibayar {waktuRingkas(b.paidDate, b.createdAt)}</>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {!selesai && <Sentinel ref={ref} sisa={terurut.length - terlihat} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Daftar: Sudah Dibayar                                               */
/* ------------------------------------------------------------------ */

function DaftarHistory({
  list,
  onDetail,
}: {
  list: ItsfoodPaymentHistory[];
  onDetail: (h: ItsfoodPaymentHistory) => void;
}) {
  const { ref, terlihat, selesai } = useTahap(list.length);
  if (list.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Belum ada pembayaran masuk.
      </p>
    );
  }
  return (
    <div>
      <ul className="space-y-2.5">
        {list.slice(0, terlihat).map((h) => (
          <li key={h.id}>
            {/* Seluruh kartu tombol — afordans "bisa dibuka" lewat hover
                + chevron. Layout dua baris yang TETAP: baris 1 = tanggal +
                bank kiri, total kanan; baris 2 = jumlah order. Flex-wrap
                yang memindah-mindahkan total itu yang bikin berantakan. */}
            <button
              onClick={() => onDetail(h)}
              className="w-full rounded-2xl border border-border/60 bg-background p-3 text-left transition-colors hover:border-primary/60"
            >
              <div className="flex items-center justify-between gap-x-3">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="text-sm font-bold">
                    {tanggalPendekItsfood(h.paidDate)}
                  </p>
                  {h.bank && <BadgeBank bank={h.bank} />}
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-sm font-bold tabular-nums">
                    {rupiah(h.totalValue)}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ›
                  </span>
                </span>
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                title={h.orderIds.map((id) => `#${id}`).join(", ")}
              >
                {h.orderIds.length} order lunas
                {h.orderIds.length <= 2 && (
                  <> · {h.orderIds.map((id) => `#${id}`).join(", ")}</>
                )}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {!selesai && <Sentinel ref={ref} sisa={list.length - terlihat} />}
    </div>
  );
}
