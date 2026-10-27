import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { Card, CardTitle, Pill } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { SheetBawah } from "@/components/ui/sheet-bawah";
import { Toast, useToast } from "@/components/ui/toast";
import { Memuat } from "@/components/ui/memuat";
import { getAccessToken } from "@/supabase/client";
import {
  linkWa,
  petaBayarDari,
  parseRupiah,
  ringkasanWa,
  statusBayarOrder,
  statusItsfoodTone,
  type ItsfoodBillable,
  type ItsfoodBill,
  type ItsfoodOrder,
  type ItsfoodOrderDetail,
  type ItsfoodPaymentHistory,
  type PetaBayarOrder,
} from "@/lib/itsfood";
import { rupiah } from "@/lib/format";
import type { RekapPembayaran } from "@/lib/itsfood";
import { bacaCacheKlien, dgnCacheKlien, kosongkanCacheKlien, segarkanKlien } from "@/lib/itsfood-api";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Itsfood — orderan dari portal supplier.itsfood.id.

   Data di-scrape live lewat /api/itsfood/* (server-side; portal tidak
   punya CORS/API). Kalender menempatkan order per TANGGAL PENGANTARAN.
   Klik tanggal → panel menampilkan order hari itu + catatan dari halaman
   detail. Order "Belum diproses" punya tombol Terima.

   Konvensi visual mengikuti DESIGN.md: Card 24px, Pill mint/amber,
   tanpa widget native (kalender digambar sendiri, pola dari date-range).
   ========================================================================== */

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
const sameDay = (a: Date, b: Date) => iso(a) === iso(b);

/* ------------------------------------------------------------------ */
/* API client (same-origin; JWT Supabase seperti headerRest())          */
/* Semua GET lewat dgnCacheKlien — pindah halaman tidak fetch ulang.    */
/* ------------------------------------------------------------------ */

/** Cache `orders:<from>:<to>` menyimpan objek {orders, stale, umurDetik},
    bukan array. Pembacaan dilakukan lewat helper ini supaya bentuknya
    konsisten dan nilai tak terduga tidak menjatuhkan render. */
function bacaOrdersCache(kunci: string): ItsfoodOrder[] | undefined {
  const c = bacaCacheKlien<{ orders: ItsfoodOrder[] }>(kunci);
  return c && Array.isArray(c.orders) ? c.orders : undefined;
}

interface InfoCache {
  stale: boolean;
  umurDetik: number;
}

async function tarikOrders(
  from: string,
  to: string,
): Promise<{ orders: ItsfoodOrder[] } & InfoCache> {
  const res = await fetch(
    `/api/itsfood/orders?from=${from}&to=${to}`,
    { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return {
    orders: json.orders as ItsfoodOrder[],
    stale: Boolean(json.stale),
    umurDetik: Number(json.umurDetik ?? 0),
  };
}

async function apiOrders(
  from: string,
  to: string,
  paksa = false,
): Promise<{ orders: ItsfoodOrder[] } & InfoCache> {
  return dgnCacheKlien(`orders:${from}:${to}`, () => tarikOrders(from, to), { paksa });
}

async function apiDetail(orderId: string): Promise<ItsfoodOrderDetail> {
  /* Detail per order juga di-cache: kartu yang sudah pernah dibuka tampil
     seketika, termasuk setelah reload penuh. */
  return dgnCacheKlien(`detail:${orderId}`, async () => {
    const res = await fetch(
      `/api/itsfood/orders?id=${orderId}`,
      { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    return json.detail as ItsfoodOrderDetail;
  });
}

async function apiAccept(orderId: string): Promise<{ sukses: boolean; pesan: string }> {
  const res = await fetch("/api/itsfood/accept", {
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

interface DataPembayaran {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
  /** Ikut cache (bentuk kanonik "payments"); halaman ini sendiri tidak
      memakainya. */
  rekap?: RekapPembayaran;
  peta: PetaBayarOrder;
}

/** Bentuk KANONIK cache "payments" — SAMA untuk semua halaman itsfood:
    daftar mentah + rekap persis seperti jawaban server. Objek turunan
    (peta status) TIDAK ikut cache karena Set/Map mati di JSON; dibangun
    ulang tiap kali dibaca. */
interface HimpunPembayaran {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
  rekap: RekapPembayaran;
}

async function tarikPembayaran(): Promise<HimpunPembayaran & InfoCache> {
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
    stale: Boolean(json.stale),
    umurDetik: Number(json.umurDetik ?? 0),
  };
}

async function apiPayments(paksa = false): Promise<DataPembayaran & InfoCache> {
  const mentah = await dgnCacheKlien("payments", tarikPembayaran, { paksa });
  return {
    ...mentah,
    peta: petaBayarDari(mentah.billables, mentah.bills, mentah.history),
  };
}

/** Baca cache "payments" + bangun peta; entri salah bentuk (cache versi
    lama / rusak) dianggap tidak ada, bukan menjatuhkan render. */
function pembayaranDariCache(): DataPembayaran | null {
  const c = bacaCacheKlien<HimpunPembayaran>("payments");
  if (
    !c ||
    !Array.isArray(c.billables) ||
    !Array.isArray(c.bills) ||
    !Array.isArray(c.history) ||
    !c.rekap
  ) {
    return null;
  }
  return { ...c, peta: petaBayarDari(c.billables, c.bills, c.history) };
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

export function ItsfoodPage() {
  const [bulanTampil, setBulanTampil] = useState(() => startOfDay(new Date()));
  /* Nilai awal dari cache (sinkron): pindah menu atau reload penuh tidak
     lagi menampilkan "memuat" kalau datanya masih segar — langsung data. */
  const [awal] = useState(() => {
    const b = startOfDay(new Date());
    const k = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}`;
    const from = iso(new Date(b.getFullYear(), b.getMonth(), 1));
    const to = iso(new Date(b.getFullYear(), b.getMonth() + 1, 0));
    const cached = bacaOrdersCache(`orders:${from}:${to}`);
    return { kunci: k, orders: cached };
  });
  const [perBulan, setPerBulan] = useState<Record<string, ItsfoodOrder[]>>(
    () => (awal.orders ? { [awal.kunci]: awal.orders } : {}),
  );
  const [memuat, setMemuat] = useState(!awal.orders);
  const [galat, setGalat] = useState("");
  const [hariDipilih, setHariDipilih] = useState<Date>(() => startOfDay(new Date()));
  const [detailPerId, setDetailPerId] = useState<Record<string, ItsfoodOrderDetail>>({});
  const [detailMemuat, setDetailMemuat] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState<ItsfoodOrder | null>(null);
  const [menerima, setMenerima] = useState(false);
  const [pembayaran, setPembayaran] = useState<DataPembayaran | null>(() =>
    pembayaranDariCache(),
  );
  const [pembayaranGalat, setPembayaranGalat] = useState("");
  /* Umur data kalender dari server — tampil sebagai teks kecil kalau
     yang ditampilkan stale (server sudah menyeret scraping ulang). */
  const [cacheInfo, setCacheInfo] = useState<InfoCache | null>(null);
  const [toast, setToast] = useToast();

  /* Pembayaran dibutuhkan untuk pill status per order — dimuat sekali,
     dicache klien, dan segarkan manual lewat tombol Muat ulang. */
  const muatPembayaran = useCallback(async (paksa = false) => {
    setPembayaranGalat("");
    if (!paksa) {
      const cached = pembayaranDariCache();
      if (cached) {
        setPembayaran(cached);
        /* Ada di lokal (localStorage) → tampil langsung; versi terbaru
           ditarik diam-diam di belakang (stale-while-revalidate): tanpa
           spinner, tanpa toast, tanpa layar kosong. */
        void segarkanKlien("payments", tarikPembayaran)
          .then((hasil) => {
            setPembayaran({
              ...hasil,
              peta: petaBayarDari(hasil.billables, hasil.bills, hasil.history),
            });
          })
          .catch(() => {});
        return;
      }
    }
    try {
      const hasil = await apiPayments(paksa);
      setPembayaran(hasil);
      setPembayaranGalat("");
    } catch (e) {
      setPembayaranGalat(e instanceof Error ? e.message : "Gagal memuat rekap pembayaran");
    }
  }, []);

  useEffect(() => {
    void muatPembayaran();
  }, [muatPembayaran]);

  const kunciBulan = `${bulanTampil.getFullYear()}-${String(bulanTampil.getMonth() + 1).padStart(2, "0")}`;

  const muatBulan = useCallback(async (bulan: Date, paksa = false) => {
    const kunci = `${bulan.getFullYear()}-${String(bulan.getMonth() + 1).padStart(2, "0")}`;
    setGalat("");
    /* Data tersimpan (localStorage) → tampil langsung TANPA spinner/toast/
       request, lalu versi terbaru ditarik diam-diam di belakang dan tampilan
       diperbarui (stale-while-revalidate). Inilah yang membuat pindah menu
       terasa instan. Tombol "Muat ulang" (paksa=true) dan bulan yang belum
       pernah diambil tetap lewat jalur memuat yang terlihat di bawah. */
    if (!paksa) {
      const fromC = iso(new Date(bulan.getFullYear(), bulan.getMonth(), 1));
      const toC = iso(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 0));
      const kunciCache = `orders:${fromC}:${toC}`;
      const cached = bacaOrdersCache(kunciCache);
      if (cached) {
        setPerBulan((lama) => ({ ...lama, [kunci]: cached }));
        setMemuat(false);
        void segarkanKlien(kunciCache, () => tarikOrders(fromC, toC))
          .then((hasil) => {
            setPerBulan((lama) => ({ ...lama, [kunci]: hasil.orders }));
            setCacheInfo({ stale: hasil.stale, umurDetik: hasil.umurDetik });
          })
          .catch(() => {});
        return;
      }
    }
    setMemuat(true);
    /* Status proses yang terlihat: tanpa ini halaman hanya diam dengan
       teks "Memuat..." kecil, dan user tidak tahu apakah sistem bekerja. */
    setToast({
      tone: "info",
      spin: true,
      text: `Memuat order ${BULAN[bulan.getMonth()]} ${bulan.getFullYear()}…`,
    });
    try {
      const from = iso(new Date(bulan.getFullYear(), bulan.getMonth(), 1));
      const to = iso(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 0));
      const hasil = await apiOrders(from, to, paksa);
      setPerBulan((lama) => ({ ...lama, [kunci]: hasil.orders }));
      setCacheInfo({ stale: hasil.stale, umurDetik: hasil.umurDetik });
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat order itsfood");
    } finally {
      setMemuat(false);
      setToast(null);
    }
  }, [setToast]);

  useEffect(() => {
    void muatBulan(bulanTampil);
    // kunciBulan sengaja tidak masuk deps: muatBulan + bulanTampil cukup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulanTampil, muatBulan]);

  const ordersBulan = perBulan[kunciBulan] ?? [];
  const perTanggal = useMemo(() => {
    const map = new Map<string, ItsfoodOrder[]>();
    for (const o of ordersBulan) {
      const list = map.get(o.deliveryDate) ?? [];
      list.push(o);
      map.set(o.deliveryDate, list);
    }
    return map;
  }, [ordersBulan]);

  const hariDipilihIso = iso(hariDipilih);
  /* Urut jam antar: dapur makan daftar ini dari atas ke bawah sebagai
     urutan kerja, jadi 08:00 harus di atas 11:00. Jam portal selalu
     HH:MM:SS lebar tetap, jadi pembanding string cukup. */
  const ordersHari = useMemo(
    () =>
      [...(perTanggal.get(hariDipilihIso) ?? [])].sort(
        (a, b) =>
          a.deliveryTime.localeCompare(b.deliveryTime) || a.id.localeCompare(b.id),
      ),
    [perTanggal, hariDipilihIso],
  );
  const pendingBulan = ordersBulan.filter((o) => o.canAccept).length;

  /* Detail order yang sedang dibuka — kartu diklik. Desktop: modal
     tengah; mobile/tablet: sheet dari bawah (lihat SheetBawah).
     orderLayar = nilai terakhir, supaya konten tetap ada selama animasi
     exit berjalan setelah state dibuka dinolkan. */
  const [orderDibuka, setOrderDibuka] = useState<ItsfoodOrder | null>(null);
  const orderLayar = useNilaiTerakhir(orderDibuka);
  const konfirmasiLayar = useNilaiTerakhir(konfirmasi);
  /* Order yang detailnya GAGAL dimuat — tidak boleh diam-diam tampil
     kosong; IsiDetailOrder menampilkan pesan + tombol coba lagi. */
  const [detailGagal, setDetailGagal] = useState<Record<string, boolean>>({});

  /* Pastikan detail satu order termuat — dipakai efek batch harian DAN
     saat kartu diklik (kalau batch-nya gagal, klik tetap menyelamatkan). */
  const muatDetail = useCallback(
    (orderId: string, paksa = false) => {
      if (!paksa && (detailPerId[orderId] || detailGagal[orderId])) return;
      setDetailMemuat(true);
      return apiDetail(orderId)
        .then((d) => {
          setDetailPerId((lama) => ({ ...lama, [orderId]: d }));
          setDetailGagal((lama) => ({ ...lama, [orderId]: false }));
        })
        .catch(() => {
          setDetailGagal((lama) => ({ ...lama, [orderId]: true }));
        })
        .finally(() => setDetailMemuat(false));
    },
    [detailPerId, detailGagal],
  );
  /* Ringkasan harian: tabel gabungan item semua order di hari terpilih —
     collapsed default, dibuka lewat tombol. */
  const [ringkasanTerbuka, setRingkasanTerbuka] = useState(false);
  /* Desktop vs mobile: diukur SETIAP render, bukan sekali di mount —
     mengecilkan/membesarkan window saat panel terbuka harus ikut pindah
     wujud (modal ↔ sheet). */
  const desktop =
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 1024px)").matches;

  /* Detail (catatan, item) diambil untuk order di hari yang dipilih —
     di-cache per order id supaya bolak-balik pilih tanggal tidak
     mengulang fetch. */
  useEffect(() => {
    if (ordersHari.length === 0) return;
    const belumAda = ordersHari.filter((o) => !detailPerId[o.id] && !detailGagal[o.id]);
    if (belumAda.length === 0) return;
    for (const o of belumAda) void muatDetail(o.id);
    // muatDetail menutup detailPerId/detailGagal — tanpa itu loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hariDipilihIso, ordersHari.length, muatDetail]);

  /* Buka detail dari kartu — kalau detailnya belum/belum berhasil
     dimuat, fetch dijalankan di sini juga; klik tidak pernah buta. */
  const bukaOrder = (o: ItsfoodOrder) => {
    setOrderDibuka(o);
    if (!detailPerId[o.id]) void muatDetail(o.id, Boolean(detailGagal[o.id]));
  };

  async function terima(order: ItsfoodOrder) {
    setMenerima(true);
    setToast({ tone: "info", spin: true, text: `Menerima order #${order.id}…` });
    try {
      const hasil = await apiAccept(order.id);
      setKonfirmasi(null);
      // Status berubah di portal → cache order basi, muat ulang paksa.
      // Pesan hasil dipasang SETELAH muat ulang: muat ulang memakai toast
      // untuk progresnya dan menutupnya sendiri, jadi pesan sukses tidak
      // boleh dipasang lebih dulu (akan terhapus).
      kosongkanCacheKlien(["orders:", "detail:", "payments"]);
      await muatBulan(bulanTampil, true);
      void muatPembayaran(true);
      setToast({ tone: hasil.sukses ? "ok" : "warn", text: hasil.pesan });
    } catch {
      setToast({ tone: "warn", text: "Gagal mengirim permintaan terima" });
    } finally {
      setMenerima(false);
    }
  }

  /* Hierarki layout: DETAIL order adalah aktor utama halaman, kalender
     hanya navigator. Makanya kolom kalender ukurannya tetap (compact),
     dan sisa lebar layar diberikan ke panel detail. */
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      {pembayaranGalat && (
        <div className="rounded-2xl bg-[#F3DBA2] px-4 py-2.5 text-xs font-semibold text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]">
          Status pembayaran gagal dimuat — pill pembayaran di kartu mungkin tidak lengkap.{" "}
          <button onClick={() => void muatPembayaran()} className="underline underline-offset-2">
            Coba lagi
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)] lg:items-start">
      <Card
        title={
          <CardTitle>
            Jadwal Pengantaran
            {cacheInfo?.stale && (
              <span className="text-xs font-medium text-muted-foreground">
                {" "}· data {Math.max(1, Math.round(cacheInfo.umurDetik / 60))} mnt lalu, disegarkan di latar
              </span>
            )}
          </CardTitle>
        }
        action={
          <div className="flex items-center gap-2">
            {pendingBulan > 0 && (
              <Pill tone="warning">{pendingBulan} belum diproses</Pill>
            )}
            <button
              onClick={() => {
                void muatBulan(bulanTampil, true);
                void muatPembayaran(true);
              }}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {memuat ? "Memuat…" : "Muat ulang"}
            </button>
          </div>
        }
      >
        {galat && (
          <div className="mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {galat}
          </div>
        )}
        <KalenderItsfood
          bulan={bulanTampil}
          perTanggal={perTanggal}
          dipilih={hariDipilih}
          onPilih={(d) => setHariDipilih(startOfDay(d))}
          onGantiBulan={(d) => setBulanTampil(startOfDay(d))}
        />
      </Card>

      {/* Panel detail. Mobile/tablet: polos memanjang ke bawah (kartu
          order berdiri sendiri, layar penuh milik mereka). Desktop: jadi
          Card dengan daftar yang scroll di dalam. Satu render, beda
          pakaian — isi tidak diduplikasi. */}
      <section
        className={cn(
          "lg:rounded-3xl lg:bg-card lg:p-5 lg:shadow-card",
        )}
      >
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-[-0.01em]">
            {hariDipilih.getDate()} {BULAN[hariDipilih.getMonth()]}{" "}
            <span className="hidden font-normal text-muted-foreground lg:inline">
              {hariDipilih.getFullYear()}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {ordersHari.length > 0 && (
              <button
                onClick={() => setRingkasanTerbuka((t) => !t)}
                aria-expanded={ringkasanTerbuka}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  ringkasanTerbuka
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground",
                )}
              >
                Ringkasan
              </button>
            )}
            {ordersHari.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                {ordersHari.length} order
              </span>
            )}
          </div>
        </header>

        {ordersHari.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Tidak ada order pengantaran di tanggal ini.
          </p>
        ) : (
          /* Scroll di dalam panel hanya saat ia Card (desktop); di mobile
             halaman yang scroll, jadi daftar memanjang natural. */
          <div className="space-y-3 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
            {ordersHari.map((o) => (
              <KartuOrder
                key={o.id}
                order={o}
                detail={detailPerId[o.id]}
                detailMemuat={detailMemuat}
                statusBayar={
                  pembayaran ? statusBayarOrder(o.id, pembayaran.peta) : undefined
                }
                onTerima={() => setKonfirmasi(o)}
                onBuka={() => bukaOrder(o)}
              />
            ))}
          </div>
        )}

        {/* Ringkasan tidak menyisip di bawah daftar — dia dialog sendiri
            (modal di desktop, sheet di mobile), pola yang sama dengan
            detail order. */}
      </section>

      </div>{/* grid kalender + detail */}

      {/* Detail order: desktop = modal tengah, mobile/tablet = sheet dari
          bawah (SheetBawah/Base UI). Animasi exit diputar oleh engine;
          useNilaiTerakhir tetap menahan konten supaya exit tidak tampil
          kosong. */}
      <Modal
        open={orderDibuka !== null && desktop}
        onClose={() => setOrderDibuka(null)}
        title={orderLayar ? `Order #${orderLayar.id}` : ""}
        subtitle={
          orderLayar
            ? detailPerId[orderLayar.id]?.pemesan || orderLayar.customer
            : undefined
        }
        size="sm:max-w-xl"
        footer={
          orderLayar?.canAccept ? (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  const o = orderLayar;
                  setOrderDibuka(null);
                  setKonfirmasi(o);
                }}
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Terima Order
              </button>
            </div>
          ) : undefined
        }
      >
        {orderLayar && (
          <IsiDetailOrder
            order={orderLayar}
            detail={detailPerId[orderLayar.id]}
            memuat={detailMemuat}
            gagal={detailGagal[orderLayar.id]}
            onCobaLagi={() => void muatDetail(orderLayar.id, true)}
          />
        )}
      </Modal>

      <SheetBawah
        open={orderDibuka !== null && !desktop}
        onClose={() => setOrderDibuka(null)}
        title={orderLayar ? `Order #${orderLayar.id}` : ""}
        subtitle={
          orderLayar
            ? detailPerId[orderLayar.id]?.pemesan || orderLayar.customer
            : undefined
        }
      >
        {orderLayar && (
          <div>
            <IsiDetailOrder
              order={orderLayar}
              detail={detailPerId[orderLayar.id]}
              memuat={detailMemuat}
              gagal={detailGagal[orderLayar.id]}
              onCobaLagi={() => void muatDetail(orderLayar.id, true)}
            />
            {orderLayar.canAccept && (
              <button
                onClick={() => {
                  const o = orderLayar;
                  setOrderDibuka(null);
                  setKonfirmasi(o);
                }}
                className="mt-5 w-full rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground"
              >
                Terima Order
              </button>
            )}
          </div>
        )}
      </SheetBawah>

      {/* Ringkasan harian: modal di desktop, sheet dari bawah di
          mobile/tablet — sama dengan wujud detail order. */}
      <Modal
        open={ringkasanTerbuka && desktop}
        onClose={() => setRingkasanTerbuka(false)}
        title={`Ringkasan ${hariDipilih.getDate()} ${BULAN[hariDipilih.getMonth()]}`}
        size="sm:max-w-2xl"
      >
        <RingkasanHarian orders={ordersHari} detailPerId={detailPerId} />
      </Modal>

      <SheetBawah
        open={ringkasanTerbuka && !desktop}
        onClose={() => setRingkasanTerbuka(false)}
        title={`Ringkasan ${hariDipilih.getDate()} ${BULAN[hariDipilih.getMonth()]}`}
        subtitle="Gabungan item semua order di hari terpilih"
      >
        <RingkasanHarian orders={ordersHari} detailPerId={detailPerId} />
      </SheetBawah>

      <Modal
        open={konfirmasi !== null}
        onClose={() => (menerima ? undefined : setKonfirmasi(null))}
        title={konfirmasiLayar ? `Terima order #${konfirmasiLayar.id}?` : ""}
        subtitle={konfirmasiLayar?.customer}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setKonfirmasi(null)}
              disabled={menerima}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Batal
            </button>
            <button
              onClick={() => konfirmasiLayar && void terima(konfirmasiLayar)}
              disabled={menerima}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {menerima ? "Mengirim..." : "Ya, Terima"}
            </button>
          </div>
        }
      >
        {konfirmasiLayar && (
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p>
              Pengantaran{" "}
              <b className="text-foreground">{konfirmasiLayar.deliveryDate}</b>{" "}
              {konfirmasiLayar.deliveryTime} —{" "}
              {konfirmasiLayar.purpose || "Tanpa keterangan"}
            </p>
            <p className="text-xs">
              Order akan langsung dikonfirmasi di portal itsfood.
            </p>
          </div>
        )}
      </Modal>

      <Toast toast={toast} posisi="atas-tengah" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kalender                                                            */
/* ------------------------------------------------------------------ */

function KalenderItsfood({
  bulan,
  perTanggal,
  dipilih,
  onPilih,
  onGantiBulan,
}: {
  bulan: Date;
  perTanggal: Map<string, ItsfoodOrder[]>;
  dipilih: Date;
  onPilih: (d: Date) => void;
  onGantiBulan: (d: Date) => void;
}) {
  /* Grid mulai Senin (format kalender Indonesia), 6 baris supaya tinggi
     stabil antar bulan — lompatan tinggi saat pindah bulan terasa rusak. */
  const sel = useMemo(() => {
    const awalBulan = new Date(bulan.getFullYear(), bulan.getMonth(), 1);
    const geser = (awalBulan.getDay() + 6) % 7; // Minggu=0 → Senin-based
    const mulai = new Date(bulan.getFullYear(), bulan.getMonth(), 1 - geser);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(mulai.getFullYear(), mulai.getMonth(), mulai.getDate() + i);
      return { date: d, diBulan: d.getMonth() === bulan.getMonth() };
    });
  }, [bulan]);

  const hariIni = startOfDay(new Date());

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onGantiBulan(new Date(bulan.getFullYear(), bulan.getMonth() - 1, 1))}
          aria-label="Bulan sebelumnya"
          className="grid h-9 w-9 place-items-center rounded-full border border-border hover:border-primary"
        >
          ‹
        </button>
        <span className="text-sm font-semibold">
          {BULAN[bulan.getMonth()]} {bulan.getFullYear()}
        </span>
        <button
          onClick={() => onGantiBulan(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 1))}
          aria-label="Bulan berikutnya"
          className="grid h-9 w-9 place-items-center rounded-full border border-border hover:border-primary"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1.5">
        {HARI.map((h) => (
          <div
            key={h}
            className="py-1 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
          >
            {h}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {sel.map(({ date, diBulan }) => {
          const orders = perTanggal.get(iso(date)) ?? [];
          const pending = orders.filter((o) => o.canAccept).length;
          const dipilihHari = sameDay(date, dipilih);
          const adaOrder = orders.length > 0 && diBulan;
          return (
            <button
              key={iso(date)}
              onClick={() => onPilih(date)}
              className={cn(
                "relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-sm transition-colors md:h-14",
                diBulan ? "" : "text-muted-foreground/40",
                /* Heatmap: sel dengan order diberi tint penuh, bukan dot
                   kecil — bulan terbaca sekali lirik. Amber = ada yang
                   belum diproses, mint = aman. Lime tetap eksklusif milik
                   sel terpilih (aturan satu aksen). */
                dipilihHari && "bg-primary font-bold text-primary-foreground",
                !dipilihHari && adaOrder && pending > 0 &&
                  "bg-[#F3DBA2]/30 font-semibold text-foreground hover:bg-[#F3DBA2]/50 dark:bg-[#3A2A10] dark:text-[#F0C987] dark:hover:bg-[#3A2A10]/70",
                !dipilihHari && adaOrder && pending === 0 &&
                  "bg-[#ECF3F1]/70 font-semibold text-foreground hover:bg-[#ECF3F1] dark:bg-[#16302A]/70 dark:text-[#7FD6B4] dark:hover:bg-[#16302A]",
                !dipilihHari && !adaOrder && diBulan && "hover:bg-muted",
              )}
            >
              <span className="tabular-nums leading-none">{date.getDate()}</span>
              {adaOrder && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-bold leading-none tabular-nums",
                    dipilihHari
                      ? "bg-[#092C1B] text-[#AEDD33]"
                      : pending > 0
                        ? "bg-[#F3DBA2] text-[#6B4A0A] dark:bg-[#F3DBA2]/20 dark:text-[#F0C987]"
                        : "bg-[#ECF3F1] text-[#1F5C4A] dark:bg-[#7FD6B4]/15 dark:text-[#7FD6B4]",
                  )}
                >
                  {orders.length}
                </span>
              )}
              {sameDay(date, hariIni) && !dipilihHari && (
                <span className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-primary/60" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-md bg-[#F3DBA2]/50 dark:bg-[#3A2A10]" />
          belum diproses
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-md bg-[#ECF3F1]/70 dark:bg-[#16302A]" />
          sudah diproses
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kartu order dalam panel hari                                        */
/* ------------------------------------------------------------------ */

function KartuOrder({
  order,
  detail,
  detailMemuat,
  statusBayar,
  onTerima,
  onBuka,
}: {
  order: ItsfoodOrder;
  detail?: ItsfoodOrderDetail;
  detailMemuat: boolean;
  /** Status pembayaran dari rekap payments portal. */
  statusBayar?: "terbayar" | "pending" | "bisa-ditagih" | "belum-bisa";
  onTerima: () => void;
  /** Buka detail (modal/sheet). */
  onBuka: () => void;
}) {
  const tone = statusItsfoodTone(order.status);
  const catatan = detail?.catatan?.trim();

  /* Daftar di portal menempelkan grup customer di belakang nama pemesan
     ("SDMO ITS SDMO ITS"). Detail page punya nama yang bersih — pakai itu
     begitu termuat, fallback ke nilai list. */
  const pemesan = detail?.pemesan?.trim() || order.customer;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onBuka}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onBuka();
        }
      }}
      /* Mobile/tablet: panel hari tidak ber-Card, jadi latar halaman = krem.
                 Kartu putih di sini. Desktop: panelnya Card putih, jadi
                 kartu pakai tint (bg-background) supaya tetap bertepi.
                 Kalau keduanya bg-background, di mobile kartu menyatu
                 dengan halaman dan bordernya tidak terlihat. */
      className="cursor-pointer rounded-2xl border border-input bg-card p-4 shadow-card transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:bg-background lg:shadow-none"
    >
      {/* Header: id kiri, aksi kanan. Kartu sendiri klikabel (buka
          detail) — Terima wajib stopPropagation biar gak ikut membuka.
          Pill status TIDAK digabung di baris ini — "Sedang Diproses" +
          Terima + #id rapet dan saling menempel di mobile/tablet. Pill
          diberi baris sendiri di bawahnya supaya selalu punya ruang, di
          viewport ukuran apa pun. */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-bold tabular-nums">#{order.id}</span>
        <div className="flex items-center gap-1.5">
          {order.canAccept && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTerima();
              }}
              className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Terima
            </button>
          )}
          <span aria-hidden="true" className="text-muted-foreground">›</span>
        </div>
      </header>

      {/* Baris status sendiri — jarakan dari header di atas dan nama
          pemesan di bawah, tidak pernah overlap. Status pembayaran hanya
          muncul kalau order sudah masuk alur tagihan; "belum-bisa" tidak
          dirender supaya tidak jadi noise di kartu. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Pill tone={tone}>{order.status}</Pill>
        {statusBayar === "terbayar" && <Pill tone="success">Sudah Dibayar</Pill>}
        {statusBayar === "pending" && <Pill tone="neutral">Tagihan Dibuat</Pill>}
        {statusBayar === "bisa-ditagih" && <Pill tone="warning">Bisa Ditagih</Pill>}
      </div>

      <h3 className="mt-2 text-[15px] font-bold leading-snug">{pemesan}</h3>

      {/* Tabel item — bahasa tabel DESIGN.md: header uppercase 11px,
          baris dipisah border tipis, angka tabular rata kanan. Dua kolom:
          jumlah menempel di nama (16× Nasi Uduk), jadi tetap terbaca di
          320px tanpa kolom tengah yang sempit. */}
      {detail && detail.items.length > 0 ? (
        <div className="mt-3">
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-input pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground dark:border-border/60">
            <span>Item</span>
            <span className="text-right">Subtotal</span>
          </div>
          <ul>
            {detail.items.map((item, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-x-3 border-b border-input py-2 text-sm last:border-b-0 dark:border-border/60"
              >
                <span className="min-w-0 font-medium">
                  <span className="font-bold tabular-nums">{item.qty}×</span>{" "}
                  {bersihkanNamaItem(item.name)}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {item.subtotal}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="py-2 text-xs italic text-muted-foreground">
          {detail
            ? "Tidak ada rincian item"
            : detailMemuat
              ? "Memuat item..."
              : "Rincian belum termuat"}
        </p>
      )}

      {/* Info pengantaran — jam & alamat adalah data operasional yang
          paling sering dibaca dari kartu ini, jadi ia blok sendiri dengan
          jam sebagai angka terbesar setelah item. bg-card + border: di
          light mode kartu induknya tint krem, blok putih + border jelas
          bentuknya — bukan putih menyatu. */}
      <div className="mt-3 rounded-xl border border-border bg-card p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Antar
          </span>
          <span className="text-[15px] font-bold tabular-nums text-foreground">
            {order.deliveryTime}
          </span>
        </div>
        {order.purpose && (
          <p className="mt-0.5 text-sm text-foreground">{order.purpose}</p>
        )}
        <p className="mt-1 text-sm font-medium text-foreground">
          {order.address}
        </p>
      </div>

      {/* Catatan hanya dirender kalau ADA isinya. Garis kiri amber sebagai
          penanda, isi text-sm — catatan spesial (level bumbu, "harap tepat
          waktu") sering menentukan keseluruhan order, jadi gak boleh
          sekecil catatan kaki. */}
      {catatan && (
        <div className="mt-3 border-l-[3px] border-[#F3DBA2] py-0.5 pl-3 dark:border-[#F0C987]/60">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8A5A12] dark:text-[#F0C987]">
            Catatan
          </p>
          <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-foreground">
            {catatan}
          </p>
        </div>
      )}
    </article>
  );
}

/* Nama item di portal menempelkan nama brand ("Es Degan - Shanti
   Catering") — di dashboard itu noise. Dibuang di lapisan tampilan saja;
   parser tetap menyimpan nilai verbatim. */
function bersihkanNamaItem(name: string): string {
  return name.replace(/\s*-\s*Shanti Catering\s*$/i, "");
}

/** Nilai terakhir yang tidak null — konten dialog tetap stabil selama
    animasi EXIT berjalan setelah state-nya dinolkan.

    Disimpan di state, BUKAN ref: ref baru terisi di useEffect (setelah
    render), jadi render pertama setelah klik masih membaca nilai lama
    (null) dan dialog tampil kosong sampai ada render lain — persis bug
    "harus ditutup lalu dibuka lagi". setState saat render aman di sini
    karena kondisinya menyempit (hanya saat nilai baru berbeda). */
function useNilaiTerakhir<T>(nilai: T | null): T | null {
  const [akhir, setAkhir] = useState<T | null>(nilai);
  if (nilai !== null && nilai !== akhir) setAkhir(nilai);
  return akhir;
}

/* ------------------------------------------------------------------ */
/* Ringkasan harian — tabel gabungan item + catatan + total, untuk     */
/* tahu sekali lirik apa saja yang masuk di hari itu.                  */
/* ------------------------------------------------------------------ */

function RingkasanHarian({
  orders,
  detailPerId,
}: {
  orders: ItsfoodOrder[];
  detailPerId: Record<string, ItsfoodOrderDetail>;
}) {
  /* Grup per order: order id muncul sekali di baris pertama grupnya,
     bukan diulang tiap item — tabel tetap kalimat yang bisa dibaca.
     Jam antar ikut di baris pertama: dapur mengurutkan kerja dari sana. */
  const grup = orders
    .map((o) => ({
      order: o,
      detail: detailPerId[o.id],
      /** Alamat tujuan: rinci dari portal bila ada, jatuh ke kolom Alamat
          daftar order supaya ringkasan tetap punya alamat sebelum detail
          termuat. */
      alamat: detailPerId[o.id]?.alamat?.trim() || o.address,
    }))
    .filter((g) => g.detail && g.detail.items.length > 0);

  const totalPorsi = grup.reduce(
    (a, g) => a + g.detail.items.reduce((b, it) => b + (parseInt(it.qty, 10) || 0), 0),
    0,
  );
  const totalRupiah = grup.reduce(
    (a, g) => a + g.detail.items.reduce((b, it) => b + parseRupiah(it.subtotal), 0),
    0,
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {grup.length} order · <b className="tabular-nums text-foreground">{totalPorsi}</b> porsi ·{" "}
        <b className="tabular-nums text-foreground">{rupiah(totalRupiah)}</b>
      </p>

      {grup.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Rincian item belum termuat.
        </p>
      ) : (
        <>
          {/* Desktop: tabel — urutan baca konvensional, kolom rata, di
              dalam wadah tint (modalnya putih). */}
          <div className="hidden rounded-2xl bg-background p-3 lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="py-1.5 pr-3 text-left font-semibold">Order</th>
                  <th className="py-1.5 pr-3 text-left font-semibold">Item</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Jumlah</th>
                  <th className="py-1.5 text-right font-semibold">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {grup.map(({ order, detail, alamat }) => (
                  <Fragment key={order.id}>
                    {detail.items.map((it, i) => (
                      <tr
                        key={`${order.id}-${i}`}
                        className="border-b border-input"
                      >
                        <td className="w-56 min-w-0 py-2 pr-3 align-top">
                          {i === 0 && (
                            <>
                              <p className="font-bold tabular-nums">#{order.id}</p>
                              <PillAntar jam={order.deliveryTime} />
                              <p className="mt-1 break-words text-[11px] leading-snug text-muted-foreground">
                                {order.customer}
                                {alamat && <> · 📍 {alamat}</>}
                              </p>
                            </>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-top font-medium">
                          {bersihkanNamaItem(it.name)}
                        </td>
                        <td className="py-2 pr-3 text-right align-top font-semibold tabular-nums">
                          {it.qty}×
                        </td>
                        <td className="py-2 text-right align-top font-semibold tabular-nums text-muted-foreground">
                          {it.subtotal}
                        </td>
                      </tr>
                    ))}
                    {detail.catatan.trim() && (
                      <tr className="border-b border-input">
                        <td colSpan={4} className="pb-3">
                          <BarisCatatan teks={detail.catatan.trim()} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: blok per order — tabel yang dipaksa sempit itu yang
              bikin susah dibaca; blok memberi tiap order ruang penuh dan
              bentuk kartunya jelas. */}
          <div className="space-y-2.5 lg:hidden">
            {grup.map(({ order, detail, alamat }) => (
              <div
                key={order.id}
                className="rounded-2xl border border-input bg-background p-3"
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold tabular-nums">#{order.id}</span>
                  <PillAntar jam={order.deliveryTime} />
                </div>
                <p className="mb-1.5 break-words text-[11px] leading-snug text-muted-foreground">
                  {order.customer}
                  {alamat && <> · 📍 {alamat}</>}
                </p>
                <ul>
                  {detail.items.map((it, i) => (
                    <li
                      key={i}
                      className="flex items-baseline justify-between gap-x-3 border-b border-input py-1.5 text-sm last:border-b-0 dark:border-border/60"
                    >
                      <span className="min-w-0 font-medium">
                        <span className="font-bold tabular-nums">{it.qty}×</span>{" "}
                        {bersihkanNamaItem(it.name)}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                        {it.subtotal}
                      </span>
                    </li>
                  ))}
                </ul>
                {detail.catatan.trim() && (
                  <div className="mt-1.5">
                    <BarisCatatan teks={detail.catatan.trim()} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Pill jam antar — data penentu urutan kerja dapur, diberi tone
    warning agarkontras di tengah baris netral. */
function PillAntar({ jam }: { jam: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full bg-[#F3DBA2] px-2 py-0.5 text-xs font-bold tabular-nums text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]">
      <span className="text-[9px] font-semibold uppercase tracking-[0.06em] opacity-80">
        Antar
      </span>
      {jam}
    </span>
  );
}

/** Catatan tanpa label "CATATAN" berulang di tiap baris — garis amber
    sudah menandai "ini catatan", teksnya yang dibaca. */
function BarisCatatan({ teks }: { teks: string }) {
  return (
    <p className="border-l-[3px] border-[#F3DBA2] pl-2.5 text-xs leading-relaxed dark:border-[#F0C987]/60">
      <span className="text-foreground">{teks}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Detail order — kartu diklik. Mobile/tablet: sheet dari bawah;       */
/* desktop: modal tengah (Modal).                                      */
/* ------------------------------------------------------------------ */

/** Tautan aksi (telp/WA/email) — lime sebagai WARNA TEKS di atas putih
    gagal kontras; teks tetap gelap, aksen lime hadir sebagai underline. */
function TautanAksi({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className="inline-flex items-center gap-1.5 font-medium text-foreground underline decoration-primary decoration-2 underline-offset-2 transition-colors hover:decoration-foreground"
    >
      {children}
    </a>
  );
}

const IKON_WA =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.347-.347.52-.52.174-.174.232-.297.347-.495.116-.198.058-.371-.058-.52-.116-.148-.695-1.651-.95-2.261-.244-.581-.49-.49-.67-.49-.174 0-.371-.025-.57-.025-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z";

/** Isi detail (dipakai modal & sheet) — dari data /orders/order/:id. */
function IsiDetailOrder({
  order,
  detail,
  memuat,
  gagal,
  onCobaLagi,
}: {
  order: ItsfoodOrder;
  detail?: ItsfoodOrderDetail;
  memuat: boolean;
  gagal?: boolean;
  onCobaLagi?: () => void;
}) {
  const catatan = detail?.catatan?.trim();
  /* Salin ringkasan untuk WA — ikon saja; feedback "tersalin" di ikon
     yang sama (copy → centang), bukan toast yang harus dicari. */
  const [tersalin, setTersalin] = useState(false);
  const teksWa = useMemo(() => ringkasanWa(order, detail), [order, detail]);
  async function salin() {
    try {
      await navigator.clipboard.writeText(teksWa);
      setTersalin(true);
      setTimeout(() => setTersalin(false), 2000);
    } catch {
      /* clipboard ditolak browser — biarkan ikon tetap copy */
    }
  }
  const baris: [string, string][] = detail
    ? (
        [
          ["Unit", detail.unit],
          ["No Telp", detail.telepon],
          ["Email", detail.email],
          ["Waktu Pemesanan", detail.waktuPemesanan],
          ["Waktu Pengantaran", detail.waktuPengantaran],
          ["Tujuan", detail.tujuan],
        ] as [string, string][]
      ).filter(([, v]) => v && v !== "-")
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold tabular-nums">#{order.id}</span>
          <Pill tone={statusItsfoodTone(order.status)}>{order.status}</Pill>
        </div>
        <button
          onClick={salin}
          title="Salin ringkasan untuk WhatsApp"
          aria-label="Salin ringkasan untuk WhatsApp"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors",
            tersalin
              ? "border-transparent bg-success/15 text-success"
              : "border-border text-muted-foreground hover:border-primary hover:text-foreground",
          )}
        >
          {tersalin ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          )}
        </button>
      </div>
      <p className="mt-1 text-[15px] font-bold">
        {detail?.pemesan?.trim() || order.customer}
      </p>

      {memuat && !detail ? (
        <Memuat teks={`Memuat rincian order #${order.id}…`} />
      ) : !detail && gagal ? (
        <div className="py-6 text-center">
          <p className="text-sm font-medium text-destructive">
            Detail gagal dimuat.
          </p>
          {onCobaLagi && (
            <button
              onClick={onCobaLagi}
              className="mt-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              Coba lagi
            </button>
          )}
        </div>
      ) : (
        <>
          {baris.length > 0 && (
            <dl className="mt-4 space-y-2 text-sm">
              {baris.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
                  <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {k}
                  </dt>
                  <dd className="min-w-0 break-words">
                    {/* No Telp → wa.me: dari HP langsung nyambung chat.
                        Email → mailto. */}
                    {k === "No Telp" && linkWa(v) ? (
                      <TautanAksi href={linkWa(v) as string}>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden="true">
                          <path d={IKON_WA} />
                        </svg>
                        {v}
                      </TautanAksi>
                    ) : k === "Email" && v.includes("@") ? (
                      <TautanAksi href={`mailto:${v}`}>{v}</TautanAksi>
                    ) : (
                      <span className={k.startsWith("Waktu") ? "tabular-nums" : ""}>
                        {v}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Alamat
                </dt>
                <dd className="min-w-0 break-words font-medium">
                  {detail?.alamat || order.address}
                </dd>
              </div>
            </dl>
          )}

          {catatan && (
            <div className="mt-4 border-l-[3px] border-[#F3DBA2] py-0.5 pl-3 dark:border-[#F0C987]/60">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8A5A12] dark:text-[#F0C987]">
                Catatan
              </p>
              <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-foreground">
                {catatan}
              </p>
            </div>
          )}

          {detail && detail.items.length > 0 && (
            <div className="mt-4 rounded-2xl bg-background p-3">
              <div className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-input pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground dark:border-border/60">
                <span>Item ({detail.items.length})</span>
                <span className="text-right">Subtotal</span>
              </div>
              <ul>
                {detail.items.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-x-3 border-b border-input py-2 text-sm last:border-b-0 dark:border-border/60"
                  >
                    <span className="min-w-0 font-medium">
                      <span className="font-bold tabular-nums">{item.qty}×</span>{" "}
                      {bersihkanNamaItem(item.name)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {item.subtotal}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
