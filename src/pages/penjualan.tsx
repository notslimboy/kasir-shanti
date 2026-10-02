import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardTitle, IconButton, Pill } from "@/components/ui/card";
import { Toast, useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { SortableTh, TableSearch, urutkan, useUrutan } from "@/components/ui/sortable-table";
import { hapusStruk, hapusStrukPermanen, restoreStruk } from "@/lib/supabase-tulis";
import { IkonAksi, IkonHapusPermanen, IkonRestore } from "@/components/ui/ikon-aksi";
import { KotCard } from "@/components/kot-card";
import { buildKitchenOrderTicket } from "@/lib/kot";
import { StrukDrawer } from "@/components/struk-drawer";
import { ChartBox } from "@/components/chart-box";
import { ChartDonut } from "@/components/chart-donut";
import { CHART_ANIM } from "@/components/chart-motion";
import { PageHeader, StatTile, Tabs, btnGhost } from "@/components/ui/kit";
import { Select } from "@/components/ui/select";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range";
import { rupiah, rupiahShort } from "@/lib/format";
import type { Sale } from "@/lib/sale";
import { menuTerlarisDari, trenPerHari, trenPerJam } from "@/lib/ringkasan";
import { grupPerKurir, kurirDariTag, petaTag, rekapOngkirPerKurir } from "@/lib/kurir";
import { cetakLaporan } from "@/lib/cetak-laporan";
import { exportPenjualanCsv } from "@/lib/export-penjualan";
import { usePintasan } from "@/lib/use-pintasan";
import { labelRentang, type Pembayaran } from "@/lib/laporan";
import { KurirCard } from "@/components/kurir-card";
import { ChartTip } from "@/components/chart-tip";

import { useData } from "@/lib/data-source";

/* Sumbu Y: satuan pilihannya mengikuti besarnya angka, supaya tidak tertulis
   "0.0 jt" untuk omset per jam yang hanya ratusan ribu. */
function ringkasTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)} jt`;
  if (v >= 1_000) return `${Math.round(v / 1_000)} rb`;
  return rupiah(v);
}

/* ==========================================================================
   Dashboard Penjualan — laporan lengkap (beda dari ringkasan di beranda).
   Fokus: rentang tanggal,Closing harian, detail per menu & struk.
   ========================================================================== */

const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());

/** "2026-09-30" dari Date lokal — dipakai untuk query rentang ke server. */
const tgl = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* Nilai yang dipakai `urutkan` untuk tiap kolom Detail Struk.

   `waktu` memakai completedIso (ISO mentah dari server), bukan completedAt
   yang sudah diformat untuk dibaca manusia. Mengurutkan "30 Sep 2026
   14.05" sebagai teks akan salah, karena yang dibandingkan karakter
   string: "14.05" lebih besar dari "09.30" padahal 14.05 lebih kecil
   dari 21.30. */
function kolomNilai(s: Sale, kolom: string): string | number | Date | null {
  switch (kolom) {
    case "no":
      return s.receiptNo;
    case "customer":
      return s.customer;
    case "waktu":
      return new Date(s.completedIso);
    case "total":
      return s.total;
    case "status":
      return s.status;
    default:
      return null;
  }
}

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function PenjualanPage() {
  const [range, setRange] = useState("Harian");
  const [status, setStatus] = useState("aktif");
  const [sedangProses, setSedangProses] = useState<number | null>(null);
  const [catatan, setCatatan] = useToast();
  const [konfirmasi, setKonfirmasi] = useState<Sale | null>(null);
  /* Modal terpisah dari `konfirmasi`: void bisa dibalikin, hapus permanen
     tidak. Satu modal untuk dua tingkat kejadian yang berbeda itu cepat
     membuat kasir menekan tombol "Ya" tanpa membaca. */
  const [konfirmasiPermanen, setKonfirmasiPermanen] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState("semua");
  const [strukAktif, setStrukAktif] = useState<Sale | null>(null);
  const [custom, setCustom] = useState<DateRange | null>(null);
  /* Pencarian & pengurutan KHSUS tabel Detail Struk, bukan seluruh halaman.
     KPI dan chart di atas sengaja tidak ikut berubah: mengetik di kotak
     yang berada di card paling bawah tidak boleh diam-diam mengubah angka
     omset di chart paling atas. Filter yang berlaku untuk halaman tetap
     hanya rentang tanggal dan customer di bagian atas. */
  const [cari, setCari] = useState("");
  const { urutan, toggle } = useUrutan();
  const data = useData();

  /* Tab Harian/Mingguan/Bulanan hanya memilih preset. Rentang yang aktif
     selalu dibaca dari kalender, jadi angka dan tanggal tidak pernah
     datang dari dua sumber yang berbeda. */
  /* Tanggal "hari ini" ikut mengikuti data, bukan jam lokal kasir. Kalau
     server memakai zona waktu yang berbeda, memotong berdasarkan jam lokal
     bisa menyingkirkan struk yang sebenarnya hari ini juga. */
  /* "Hari ini" = tanggal lokal, bukan tanggal struk terakhir. Versi lama
     juga memakai getLocalDateKey(). Kalau memakai struk terakhir, halaman
     ini nempel di hari lama begitu ada satu struk baru — orderan barusan
     tidak langsung terlihat, padahal itu yang paling dicari kasir. */
  const hariIni = useMemo(() => startOfDay(new Date()), []);

  const effectiveRange = useMemo(() => {
    if (custom) return custom;
    const today = hariIni;
    const back = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n + 1);
    if (range === "Mingguan") return { from: back(7), to: today };
    if (range === "Bulanan") return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    return { from: today, to: today };
  }, [custom, range, hariIni]);

  const jumlahHari = useMemo(() => {
    const ms = effectiveRange.to.getTime() - effectiveRange.from.getTime();
    return Math.round(ms / 86_400_000) + 1;
  }, [effectiveRange]);

  /* Satu sumber penyaringan untuk seluruh halaman: rentang tanggal lalu
     filter customer. Tabel struk dan KOT memakai hasil yang sama, jadi
     angka di laporan dan angka di KOT tidak mungkin berbeda. */
  /* Minta Supabase hanya struk pada rentang yang sedang dipilih — 2.129
     baris untuk seluruh riwayat tidak perlu ditarik ke browser. */
  useEffect(() => {
    void data.muatRentang(tgl(effectiveRange.from), tgl(effectiveRange.to));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRange.from.getTime(), effectiveRange.to.getTime(), data.status]);

  const daftarCustomer = data.customers;

  /* data.struk sudah hasil query berfilter rentang dari server, jadi di
     sini tidak perlu memotong tanggal lagi — cukup filter customer. */
  const struk = useMemo(() => {
    const nama = daftarCustomer.find((c) => c.id === customer)?.name;
    if (!nama) return data.struk;
    return data.struk.filter((s) => s.customer === nama);
  }, [customer, data.struk, daftarCustomer]);

  /* Baris yang benar-benar tampil di tabel Detail Struk: `struk` sudah
     difilter rentang + customer, lalu disaring lagi oleh kotak pencarian
     dan diurutkan sesuai kolom yang diklik.

     Pencarian sengaja membandingkan seluruh isi baris yang relevan, bukan
     hanya kolom Customer: yang dicari kasir biasanya nomor struk ("048"),
     dan mengetik itu di kolom customer akan selalu kosong. Pencocokan
     dilakukan case-insensitive dan tanpa spasi di tepi, jadi "  sari  "
     tetap menemukan "Sari".

     Angka ikut dicari lewat `total` mentah, bukan hasil format rupiah —
     orang menulis "725500", bukan "Rp 725.500". Format rupiah memakai
     titik pemisah ribuan yang sama dengan teks lain, jadi mengira
     "2.725.500" sebagai satu token hanya menambah sumber Miss. */
  const barisDetail = useMemo(() => {
    /* Tab Aktif/Terhapus dulunya cuma mengubah angka di badge, tidak
       menyentuh baris yang tampil — `struk` dipakai apa adanya. Dipindah
       ke sini, dan itu yang membuat tabnya berarti: tanpa filter ini,
       "hapus struk" tidak akan terlihat efeknya karena barisnya tetap
       nangkring di tabel. */
    const perStatus =
      status === "hapus"
        ? struk.filter((s) => s.status === "terhapus")
        : struk.filter((s) => s.status !== "terhapus");
    const kunci = cari.trim().toLowerCase();
    const disaring = kunci
      ? perStatus.filter((s) =>
          [s.receiptNo, s.customer, s.payment, s.status].some((t) => t.toLowerCase().includes(kunci)) ||
          String(s.total).includes(kunci),
        )
      : perStatus;
    return urutkan(disaring, urutan, kolomNilai);
  }, [struk, status, cari, urutan]);

  /* KOT bukan daftar struk: itu rekap per nama menu untuk rentang yang
     sama dengan laporan. Pakai data yang sudah difilter, supaya angka di
     KOT dan angka di laporan tidak pernah beda. */
  const omsetRentang = useMemo(
    () => struk.reduce((a, s) => a + (s.status === "terhapus" ? 0 : s.total), 0),
    [struk],
  );
  const jumlahTransaksi = struk.filter((s) => s.status !== "terhapus").length;
  const piutangRentang = useMemo(() => {
    const belum = struk.filter((s) => s.status === "belum");
    return {
      nominal: belum.reduce((a, s) => a + (s.total - (s.diskon ?? 0) + (s.ongkir ?? 0)), 0),
      count: belum.length,
    };
  }, [struk]);
  const labelRentangPendek = `${jumlahHari} hari`;

  /* Jumlah tab harus ikut rentang & filter. Angka tetap di sini pernah
    melompat ke 1.000 struk begitu tab Harian mengirim seluruh riwayat. */
  const jumlahAktif = struk.filter((x) => x.status !== "terhapus").length;
  const jumlahTerhapus = struk.filter((x) => x.status === "terhapus").length;

  /* Hapus = void, restore = balikin. Keduanya soft delete lewat
     `deleted_at`, dan setelahnya dataharus ditarik ulang PAKSA.
     `muatRentang` biasa akan skip karena rentangnya sama, jadi tanpa
     `segarkanRentang` tabelnya tetap nampilin struk yang barusan dihapus
     dan kelihatan seperti tombolnya mati. */
  const jalankan = async (s: Sale, aksi: "hapus" | "restore" | "permanen") => {
    setSedangProses(s.id);
    try {
      const hasil =
        aksi === "hapus"
          ? await hapusStruk(s.id)
          : aksi === "restore"
            ? await restoreStruk(s.id)
            : await hapusStrukPermanen(s.id);
      if (!hasil.ok) {
        setCatatan({ tone: "warn", text: hasil.pesan });
        return;
      }
      await data.segarkanRentang(tgl(effectiveRange.from), tgl(effectiveRange.to));
      setKonfirmasi(null);
      setKonfirmasiPermanen(null);
      /* Drawer ditutup setelah berhasil. `strukAktif` masih menunjuk
         objek lama — statusnya "lunas" walau barisnya sudah terhapus di
         server — dan drawer hanya mereset form kalau `receiptNo` berubah.
         Kalau dibiarkan terbuka, panelnya menampilkan struk seolah masih
         hidup, padahal sudah tidak ada. */
      setStrukAktif(null);
      setCatatan({
        tone: "ok",
        text:
          aksi === "hapus"
            ? `${s.receiptNo} dipindahkan ke Terhapus.`
            : aksi === "restore"
              ? `${s.receiptNo} dikembalikan ke Aktif.`
              : `${s.receiptNo} dihapus permanen.`,
      });
    } finally {
      setSedangProses(null);
    }
  };

  /* Grafik memakai struk yang sedang tampil, jadi grafik dan tabel di bawahnya
     tidak mungkin beda.
     Per jam HANYA untuk rentang satu hari — untuk rentang seminggu atau
     sebulan, "jam berapa ramai" tidak bisa dijawab dari data itu dan
     perbandingan antar hari justru jadi kabur. */
  const perJam = jumlahHari === 1;
  const trenHarian = useMemo(() => trenPerHari(struk), [struk]);
  const trenJam = useMemo(() => (perJam ? trenPerJam(struk) : []), [struk, perJam]);
  const tren = perJam ? trenJam : trenHarian;

  /* Sumbu Y tidak boleh dikunci di 5 juta: per jam, omset satu jam cuma
     ratusan ribu, jadi grafiknya akan rata seperti garis datar dan
     kelihatan sepi padahal ramai. Batas atas dibulatkan ke angka yang enak
     dibaca supaya nilai teratas tidak persis menempel di garis. */
  const batasOmzet = useMemo(() => {
    const maks = Math.max(0, ...tren.map((t) => t.omset));
    if (maks <= 0) return 100_000;
    const langkah = maks <= 500_000 ? 100_000 : maks <= 5_000_000 ? 1_000_000 : 5_000_000;
    return Math.ceil((maks * 1.15) / langkah) * langkah;
  }, [tren]);

  /* "30 September 2026" untuk rentang satu hari — nama hari yang sedang
     dilihat, bukan nama bulan berjalan. */
  const labelPeriode = useMemo(() => {
    const f = effectiveRange.from;
    const t = effectiveRange.to;
    const bulan = (d: Date) => `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
    return f.getTime() === t.getTime() ? bulan(f) : `${bulan(f)} – ${bulan(t)}`;
  }, [effectiveRange]);

  const terlaris = useMemo(() => menuTerlarisDari(struk, 6), [struk]);
  const metode = useMemo(() => {
    const peta = new Map<string, number>();
    let total = 0;
    for (const x of struk) {
      if (x.status === "terhapus") continue;
      peta.set(x.payment, (peta.get(x.payment) ?? 0) + x.total);
      total += x.total;
    }
    return [...peta.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, v]) => ({ name, total: v, pct: total ? Math.round((v / total) * 100) : 0 }));
  }, [struk]);

  /* Kurir diturunkan dari tag area di customers, sama seperti script.js
     lama. Struk di halaman ini sudah terpotong rentang dan customer, jadi
     angkanya ikut terpotong — tidak perlu query kedua. */
  const ongkirRentang = useMemo(() => {
    const tagUntukNama = petaTag(data.customers.map((c) => ({ name: c.name, tag: c.tag })));
    const rekap = rekapOngkirPerKurir(
      struk.map((x) => ({
        ongkir: x.ongkir ?? 0,
        customerName: x.customer,
        statusTerhapus: x.status === "terhapus",
        tanggal: x.completedOn,
      })),
      tagUntukNama,
    );
    return { ...rekap, grup: grupPerKurir(rekap.rows) };
  }, [struk, data.customers]);

  const kot = useMemo(
    () => buildKitchenOrderTicket(struk, effectiveRange.from, effectiveRange.to),
    [struk, effectiveRange],
  );

  /* Label rentang untuk judul laporan: "Hari ini, Rabu, 30 September 2026"
     untuk satu hari, "… - …" untuk rentang. Format ini ikut formatDateLabel
     di script.js lama supaya cetakan tidak berubah. */
  const labelRentangLaporan = useMemo(() => {
    const t = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return labelRentang(t(effectiveRange.from), t(effectiveRange.to));
  }, [effectiveRange]);

  /* Laporan memakai data yang sama dengan yang sedang tampil — rentang dan
     filter customer yang sama — supaya angka di kertas sama dengan angka di
     layar. Kalau laporan menarik sendiri, dua laporan bisa berbeda. */
  const cetakLaporanSekarang = useMemo(() => {
    const tagUntukNama = petaTag(data.customers.map((c) => ({ name: c.name, tag: c.tag })));
    return () => {
      if (struk.length === 0) return;
      const hidup = struk.filter((x) => x.status !== "terhapus");
      const totalOngkir = hidup.reduce((a, x) => a + (x.ongkir ?? 0), 0);
      const petaBayar = new Map<string, Pembayaran>();
      for (const x of hidup) {
        const cur = petaBayar.get(x.payment) ?? { name: x.payment, count: 0, total: 0 };
        cur.count += 1;
        cur.total += x.total;
        petaBayar.set(x.payment, cur);
      }
      const ongkirRekap = rekapOngkirPerKurir(
        hidup.map((x) => ({
          ongkir: x.ongkir ?? 0,
          customerName: x.customer,
          statusTerhapus: false,
          tanggal: x.completedOn,
        })),
        tagUntukNama,
      );

      cetakLaporan({
        struk: hidup,
        labelRentang: labelRentangLaporan,
        ringkasan: {
          omset: omsetRentang,
          transaksi: jumlahTransaksi,
          item: hidup.reduce((a, x) => a + x.itemCount, 0),
          ongkir: totalOngkir,
        },
        pembayaran: [...petaBayar.values()].sort((a, b) => b.total - a.total),
        ongkirPerTag: ongkirRekap.rows,
        ongkirTotal: ongkirRekap.total,
        kurirUntuk: (x) => kurirDariTag(tagUntukNama(x.customer)),
        dicetakPada: new Date().toLocaleString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    };
  }, [struk, data.customers, labelRentangLaporan, omsetRentang, jumlahTransaksi]);

  /* Export CSV memakai struk yang sama dengan laporan: rentang + filter
     customer yang sama. Kalau menarik data sendiri, file yang diunduh bisa
     berisi transaksi yang tidak terlihat di layar.

     Tombolnya mati kalau rentang ini benar-benar kosong: klik yang tidak
     melakukan apa-apa terasa lebih baik daripada file CSV berisi header
     saja yang nanti dibuka Excel. */
  const exportCsvSekarang = useMemo(() => {
    return () => {
      const hasil = exportPenjualanCsv(
        { struk, labelRentang: labelRentangLaporan },
        tgl(effectiveRange.from),
        tgl(effectiveRange.to),
      );
      setCatatan(
        hasil.ok
          ? { tone: "ok", text: `${hasil.baris} baris transaksi diexport ke ${hasil.namaFile}.` }
          : { tone: "warn", text: hasil.pesan },
      );
    };
  }, [struk, labelRentangLaporan, effectiveRange]);

  const jumlahExport = struk.filter((s) => s.status !== "terhapus").length;

  /* F4 = cetak laporan, seperti di aplikasi lama. */
  const pintasan = useMemo(() => ({ F4: cetakLaporanSekarang }), [cetakLaporanSekarang]);
  usePintasan(pintasan);

  return (
    <div>
      <PageHeader
        title="Dashboard Penjualan"
        sub="Ringkasan omzet, closing harian, dan detail transaksi."
        action={
          /* Action TIDAK dilebar penuh di bawah sm. PageHeader memakai
             justify-between, jadi blok action tetap duduk di kiri dan
             ikut isinya — tombol selebar layar hanya terlihat seperti
             banner, bukan kendali. Keduanya tetap h-11 supaya target
             sentuhnya tidak mengecil. */
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsvSekarang}
              disabled={jumlahExport === 0}
              title={
                jumlahExport === 0
                  ? "Belum ada transaksi di rentang ini"
                  : `Export CSV — ${jumlahExport} transaksi, ${labelRentangPendek}`
              }
              className="h-11 shrink-0 whitespace-nowrap rounded-full border border-input bg-card px-4 text-sm font-semibold transition-colors enabled:hover:border-ring disabled:cursor-not-allowed disabled:opacity-45"
            >
              Export CSV
            </button>
            {/* Tombol icon saja: F4 tetap jalan, shortcut-nya ada di title
                dan aria-label. Menulis "F4" di dalam tombol memudahkan
                pembaca, tapi jadi lubang di layout — tombol ini duduk di
                baris yang sama dengan "Export CSV". */}
            <IconButton
              onClick={cetakLaporanSekarang}
              disabled={jumlahTransaksi === 0}
              label="Cetak laporan penjualan (F4)"
              title={
                jumlahTransaksi === 0
                  ? "Belum ada transaksi di rentang ini"
                  : `Cetak laporan penjualan (F4) — ${labelRentangPendek}, ${jumlahTransaksi} transaksi`
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
                strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                <path d="M6 9V3h12v6M6 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 15h10v6H7v-6Z" />
              </svg>
            </IconButton>
          </div>
        }
      />

      {/* Baris filter. Di bawah sm tiap kontrol jadi satu baris penuh:
            `w-64`/`w-72` di dalam flex-wrap pada layar 390px menyisakan
            ruang kosong di sebelah kanan dan membuat tombol berikutnya
            turun setengah — terbaca seperti layout yang gagal, bukan
            pilihan yang disengaja. Tabs tetap boleh melebar penuh dan
            menggulir horizontal sendiri. */}
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <Tabs
          className="self-start"
          value={range}
          onChange={(id) => {
            setRange(id);
            if (id !== "Custom") setCustom(null);
          }}
          items={[
            { id: "Harian", label: "Harian" },
            { id: "Mingguan", label: "Mingguan" },
            { id: "Bulanan", label: "Bulanan" },
            { id: "Custom", label: "Custom" },
          ]}
        />

        <Select
          className="w-full sm:w-64"
          ariaLabel="Filter customer"
          searchable
          searchPlaceholder="Cari nama atau alamat…"
          value={customer}
          onChange={setCustomer}
          options={[
            { value: "semua", label: "Semua customer" },
            ...daftarCustomer.map((c) => ({ value: c.id, label: c.name, hint: c.tag ?? undefined })),
          ]}
        />

        <DateRangePicker
          className="w-full sm:w-72"
          value={effectiveRange}
          onChange={(r) => {
            setCustom(r);
            if (r) setRange("Custom");
          }}
        />

        <span className="self-start rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground figure sm:self-auto">
          {jumlahHari} hari
        </span>
      </div>

      {/* KPI dihitung dari struk yang sedang ditampilkan, bukan dari angka
          tetap: kartu ini dan tabel di bawahnya harus selalu sama. */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Omset"
          value={rupiah(omsetRentang)}
          hint={labelRentangPendek}
          tone="accent"
        />
        <StatTile label="Transaksi" value={String(jumlahTransaksi)} hint="pada rentang ini" />
        <StatTile
          label="Rata-rata"
          value={rupiahShort(jumlahTransaksi > 0 ? Math.round(omsetRentang / jumlahTransaksi) : 0)}
          hint="per transaksi"
        />
        <StatTile
          label="Piutang"
          value={rupiahShort(piutangRentang.nominal)}
          hint={`${piutangRentang.count} struk`}
          tone="warn"
        />
      </div>

      {/* chart + payment */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          fillBody
          className="min-h-[300px] sm:min-h-[340px]"
          title={<CardTitle hint>{perJam ? `Omset per jam · ${labelPeriode}` : `Omset harian · ${labelPeriode}`}</CardTitle>}
        >
          <ChartBox fill>
            {(w, h) => {
              /* Sama seperti di Beranda: di layar sempit sumbu Y dan jumlah
                 tick X memakan sebagian besar lebar chart, jadi lebar axes,
                 jumlah tick, dan jarak tick ikut mengikuti lebar yang benar-
                 benar tersedia. Tanpa ini chart melebar keluar kartu di
                 tablet, tempat lebarnya cukup untuk sepenuhnya tapi tidak
                 cukup untuk sumbu Y 60px + tick X setiap 4 label. */
              const sempit = w < 420;
              return (
                <AreaChart
                  width={w}
                  height={h}
                  data={tren}
                  margin={{ top: 8, right: 8, left: sempit ? 0 : -8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="gPenjualan" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={perJam ? (sempit ? 3 : 2) : (sempit ? 7 : 4)}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tickLine={false} axisLine={false} width={sempit ? 44 : 60} tickCount={sempit ? 4 : 6} domain={[0, batasOmzet]}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v: number) => ringkasTick(v)} />
                  <Tooltip
                    content={<ChartTip kind={perJam ? "Jam" : "Tanggal"} />}
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4" }}
                  />
                  <Area type="monotone" dataKey="omset" stroke="var(--chart-3)" strokeWidth={3}
                    fill="url(#gPenjualan)" {...CHART_ANIM} />
                </AreaChart>
              );
            }}
          </ChartBox>
        </Card>

        <Card title="Metode Pembayaran">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            <ChartDonut data={metode} />
            <ul className="min-w-0 flex-1 space-y-2.5">
              {metode.map((m, i) => (
                <li key={m.name} className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART[i % CHART.length] }} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="font-semibold figure">{m.pct}%</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {/* menu terlaris + KOT + kurir.
          Urutannya mengikuti alur kerja: lihat menu yang laku → cetak KOT →
          lihat ongkir. Ongkir paling sempit karena isinya cuma 4 baris.

          Breakpoint dua kolom mulai di lg, bukan xl. Tablet punya ruang
          untuk dua kolom yang nyaman; memaksakan tiga kolom hanya di xl
          berarti tablet (768-1280px) turun ke satu kolom dengan tinggi
          tetap 340px, dan KOT + BarChart + KurirCard jadi tiga kartu
          setinggi itu, masing-masing dengan banyak ruang kosong —
          sementara donut pembayaran di sebelahnya tetap melebar penuh. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(0,0.7fr)]">
        <Card
          fillBody
          /* min-h, bukan h: tinggi mengikuti isi kartu di mobile/tablet
             supaya tidak ada kotak kosong 340px yang isinya 4 baris.
             Di xl kartu ini disejajarkan dengan KOT di sebelahnya lewat
             h tetap pada masing-masing kartu. */
          className="min-h-[300px] xl:h-[340px]"
          title={`Menu Terlaris (${labelRentangPendek})`}
        >
          <ChartBox fill>
            {(w, h) => (
              <BarChart width={w} height={h} data={terlaris} layout="vertical" margin={{ top: 4, right: 34, left: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="4 4" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={Math.min(132, Math.round(w * 0.34))} tickLine={false} axisLine={false}
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  content={<ChartTip format={(v) => `${v} terjual`} />}
                />
                <Bar dataKey="qty" fill="var(--chart-3)" radius={8} barSize={14} {...CHART_ANIM}>
                  {/* Angkanya ditulis di dalam chart, bukan cuma di tooltip:
                      angka ini yang dicari supervisor, jadi harus terbaca
                      tanpa perlu hover. */}
                  <LabelList
                    dataKey="qty"
                    position="insideRight"
                    offset={10}
                    style={{ fill: "var(--primary-foreground)", fontSize: 11, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            )}
          </ChartBox>
        </Card>

        <KotCard ticket={kot} />


        <Card fillBody className="min-h-[300px] xl:h-[340px]" title="Ongkir per Kurir">
          <KurirCard
            kurir={ongkirRentang.grup}
            total={ongkirRentang.total}
            rentang={labelRentangPendek}
          />
        </Card>
      </div>

      {/* detail struk */}
      <Card
        className="mt-4"
        title="Detail Struk"
        /* `self-start`: Tabs di header Card yang melebar penuh menyisakan
           ruang kosong setelah tab terakhir. */
        action={
          <Tabs
            className="self-start"
            value={status}
            onChange={setStatus}
            items={[
              { id: "aktif", label: "Aktif", count: jumlahAktif },
              { id: "hapus", label: "Terhapus", count: jumlahTerhapus },
            ]}
          />
        }
      >
        {/* Pencarian + pengurutan baris. Kotak cari jadi selebar layar di bawah
            sm: kalau hanya ikut flex dengan lebar tetap, sisa ruang habis
            dipakai tombol "Batal" yang ikut terpotong. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TableSearch
            value={cari}
            onChange={setCari}
            placeholder="Cari no struk atau customer..."
            className="w-full sm:w-auto sm:flex-1 sm:min-w-[220px]"
          />
          {/* Jumlah yang tampil harus jujur soal hasil saringan, bukan
             jumlah keseluruhan: tanpa ini, mengetik yang tidak cocok
              membuat tabel kosong tanpa penjelasan. */}
          {cari.trim() ? (
            <button
              onClick={() => setCari("")}
              className="h-9 shrink-0 rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {barisDetail.length} dari {struk.length} · Batal
            </button>
          ) : null}
        </div>

        {/* Tabel 6 kolom butuh min-w 720px. Di HP itu berarti tabel melebar
            dua kali lipat layar dan kasir harus menggulir horizontal untuk
            membaca nomor struk — posisi yang tidak mungkin dipakai sambil
           tusuk order. Jadi di bawah lg tabel disembunyikan dan diganti
            daftar kartu: satu struk = satu kartu, isinya ditumpuk
            vertikal sehingga tidak ada yang terpotong. */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <SortableTh kolom="no" urutan={urutan} onToggle={toggle}>
                  No Struk
                </SortableTh>
                <SortableTh kolom="customer" urutan={urutan} onToggle={toggle}>
                  Customer
                </SortableTh>
                <SortableTh kolom="waktu" urutan={urutan} onToggle={toggle}>
                  Waktu
                </SortableTh>
                <SortableTh kolom="total" urutan={urutan} onToggle={toggle} align="right" className="pr-5">
                  Total
                </SortableTh>
                <SortableTh kolom="status" urutan={urutan} onToggle={toggle} className="pl-5">
                  Status
                </SortableTh>
                <th scope="col" className="pb-2 text-right font-semibold">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody>
              {barisDetail.map((s) => (
                <tr
                  key={s.receiptNo}
                  onClick={() => setStrukAktif(s)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setStrukAktif(s);
                    }
                  }}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="py-2.5 font-medium figure">{s.receiptNo}</td>
                  <td className="py-2.5 max-w-[220px] truncate">{s.customer}</td>
                  <td className="py-2.5 text-muted-foreground figure">{s.completedAt}</td>
                  <td className="py-2.5 pr-5 text-right font-semibold figure">{rupiah(s.total)}</td>
                  <td className="py-2.5 pl-5">
                    {s.status === "lunas" && <Pill tone="success">Lunas</Pill>}
                    {s.status === "belum" && <Pill tone="warning">Belum Lunas</Pill>}
                    {s.status === "terhapus" && <Pill tone="danger">Terhapus</Pill>}
                  </td>
                  <td className="py-2.5 text-right">
                    {/* `stopPropagation` wajib: seluruh baris ini adalah
                        tombol besar yang membuka detail struk. Tanpa
                        penghentian, klik "Hapus" akan membuka drawer DAN
                        sekaligus menyiapkan konfirmasi — dua aksi untuk
                        satu klik. */}
                    {s.status === "terhapus" ? (
                      /* Dua ikon berdampingan, bukan dua kata: kolom Aksi
                         tidak perlu selebar "Hapus permanen", dan bentuknya
                         (panah berputar vs api) sudah bedakan tanpa dibaca.
                         stopPropagation pindah ke pembungkusnya supaya dua
                         tombol ini tetap tidak membuka drawer. */
                      <div
                        className="flex items-center justify-end gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IkonAksi
                          label={"Kembalikan struk " + s.receiptNo + " ke tab Aktif"}
                          title="Kembalikan ke Aktif"
                          onClick={() => void jalankan(s, "restore")}
                          disabled={sedangProses === s.id}
                        >
                          <IkonRestore />
                        </IkonAksi>
                        <IkonAksi
                          label={"Hapus permanen struk " + s.receiptNo}
                          title="Hapus permanen — tidak bisa dikembalikan"
                          nada="hapus"
                          onClick={() => setKonfirmasiPermanen(s)}
                          disabled={sedangProses === s.id}
                        >
                          <IkonHapusPermanen />
                        </IkonAksi>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setKonfirmasi(s);
                        }}
                        disabled={sedangProses === s.id}
                        className="h-8 rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-40"
                      >
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {/* Tabel kosong tanpa penjelasan sama dengan error: yang
                  terjadi bisa "salah cari" atau memang tidak ada struk
                  di rentang ini, dan keduanya perlu kalimat yang
                  berbeda supaya kasir tahu harus mengetik apa. */}
              {barisDetail.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    {cari.trim()
                      ? `Tidak ada struk yang cocok dengan "${cari.trim()}".`
                      : "Tidak ada struk pada rentang dan filter ini."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Daftar kartu — padanan tabel di bawah lg. */}
        <ul className="space-y-2 lg:hidden">
          {barisDetail.map((s) => (
            <li key={s.receiptNo}>
              <div
                onClick={() => setStrukAktif(s)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setStrukAktif(s);
                  }
                }}
                className="cursor-pointer rounded-2xl border border-border bg-card p-3 text-left transition-colors active:bg-muted/60"
              >
                {/* Baris 1: no struk + total. Nomor dipotong dari KIRI
                    (`truncate` + `text-right`) karena sufiks "-0047" yang
                    membedakan struk berada di ujung — kalau dipotong dari
                    kanan, semua baris terlihat sama. */}
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-semibold figure">
                    {s.receiptNo}
                  </span>
                  <span className="shrink-0 text-base font-bold figure">
                    {rupiah(s.total)}
                  </span>
                </div>

                {/* Baris 2: customer. */}
                <div className="mt-1 truncate text-sm">{s.customer}</div>

                {/* Baris 3: waktu, status, aksi. */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground figure">
                    {s.completedAt}
                  </span>
                  {s.status === "lunas" && <Pill tone="success">Lunas</Pill>}
                  {s.status === "belum" && <Pill tone="warning">Belum Lunas</Pill>}
                  {s.status === "terhapus" && <Pill tone="danger">Terhapus</Pill>}
                  <div
                    className="ml-auto shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.status === "terhapus" ? (
                      <div className="flex items-center gap-1.5">
                        <IkonAksi
                          label={"Kembalikan struk " + s.receiptNo + " ke tab Aktif"}
                          title="Kembalikan ke Aktif"
                          onClick={() => void jalankan(s, "restore")}
                          disabled={sedangProses === s.id}
                        >
                          <IkonRestore />
                        </IkonAksi>
                        <IkonAksi
                          label={"Hapus permanen struk " + s.receiptNo}
                          title="Hapus permanen — tidak bisa dikembalikan"
                          nada="hapus"
                          onClick={() => setKonfirmasiPermanen(s)}
                          disabled={sedangProses === s.id}
                        >
                          <IkonHapusPermanen />
                        </IkonAksi>
                      </div>
                    ) : (
                      <button
                        onClick={() => setKonfirmasi(s)}
                        disabled={sedangProses === s.id}
                        className="h-9 rounded-full border border-border px-3.5 text-xs font-semibold text-muted-foreground transition-colors active:border-destructive active:text-destructive disabled:opacity-40"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
          {barisDetail.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-input py-10 text-center text-sm text-muted-foreground">
              {cari.trim()
                ? `Tidak ada struk yang cocok dengan "${cari.trim()}".`
                : "Tidak ada struk pada rentang dan filter ini."}
            </li>
          ) : null}
        </ul>
      </Card>

      <StrukDrawer
        sale={strukAktif}
        onClose={() => setStrukAktif(null)}
        /* Void dari drawer tidak langsung menulis: yang dipanggil hanya
           membuka konfirmasi. Menulis dari dalam drawer tanpa konfirmasi
           berarti satu klik menghapus struk. */
        onHapus={(s) => setKonfirmasi(s)}
        onRestore={(s) => void jalankan(s, "restore")}
        onHapusPermanen={(s) => setKonfirmasiPermanen(s)}
        sedangProses={strukAktif !== null && sedangProses === strukAktif.id}
      />

      {/* Konfirmasi hapus.

          Hapus struk itu keputusan yang tidak bisa dibalik dari sisi kasir
          ( harus lewat tab Terhapus), jadi konfirmasi di sini menyebut nomornya
          dan akibatnya. Tanpa itu, satu klik salah target akan menghapus
          struk yang sebenarnya masih hidup. */}
      <Modal
        open={konfirmasi !== null}
        onClose={() => setKonfirmasi(null)}
        title="Hapus struk ini?"
        subtitle={konfirmasi ? `${konfirmasi.receiptNo} · ${konfirmasi.customer}` : undefined}
        footer={
          <div className="flex gap-2">
            <button onClick={() => setKonfirmasi(null)} className={btnGhost + " flex-1"}>
              Batal
            </button>
            <button
              onClick={() => konfirmasi && void jalankan(konfirmasi, "hapus")}
              disabled={sedangProses === konfirmasi?.id}
              className="h-11 flex-1 rounded-full bg-destructive px-4 font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {sedangProses === konfirmasi?.id ? "Menghapus..." : "Ya, hapus struk"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          Struk akan dipindahkan ke tab <strong className="text-foreground">Terhapus</strong> dan
          dikeluarkan dari omset, KPI, dan piutang. Datanya tidak hilang — bisa dikembalikan dari
          tab Terhapus selama masih ada di rentang tanggal ini.
        </p>
      </Modal>

      {/* Konfirmasi hapus permanen.

          Struk ini sudah tidak ada di omset, KPI, maupun piutang — jadi
          menghapus barisnya tidak mengubah satu pun angka di halaman ini.
          Yang hilang adalah buktinya: kalau ternyata struk ini salah hapus,
          tidak ada jalan lagi untuk membacanya. Karena itu modal ini menyebut
          nomornya, nominalnya, dan mencatat bahwa tidak bisa dibalikin. */}
      <Modal
        open={konfirmasiPermanen !== null}
        onClose={() => setKonfirmasiPermanen(null)}
        title="Hapus permanen?"
        subtitle={
          konfirmasiPermanen
            ? `${konfirmasiPermanen.receiptNo} · ${konfirmasiPermanen.customer} · ${rupiah(konfirmasiPermanen.total)}`
            : undefined
        }
        footer={
          <div className="flex gap-2">
            <button onClick={() => setKonfirmasiPermanen(null)} className={btnGhost + " flex-1"}>
              Batal
            </button>
            <button
              onClick={() => konfirmasiPermanen && void jalankan(konfirmasiPermanen, "permanen")}
              disabled={sedangProses === konfirmasiPermanen?.id}
              className="h-11 flex-1 rounded-full bg-destructive px-4 font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {sedangProses === konfirmasiPermanen?.id ? "Menghapus..." : "Ya, hapus permanen"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          Baris struk ini beserta seluruh rincian item dan pembayarannya{" "}
          <strong className="text-foreground">dihapus dari database</strong>. Angka di halaman ini
          tidak berubah — struknya sudah tidak dihitung di omset, KPI, maupun piutang.
        </p>
        <p className="mt-2 text-sm font-semibold text-destructive">
          Tidak bisa dikembalikan, tidak ada backup di aplikasi ini. Kalau struk ini ternyata
          masih dibutuhkan, tekan Batal dan biarkan di tab Terhapus.
        </p>
      </Modal>

      {/* Toast laporan hasil aksi (hapus / restore / permanen / export).
          Dipakai komponen yang sama dengan halaman lain supaya timer
          hilangnya seragam — dan supaya tidak ada lagi toast yang hanya
          hilang setelah halaman di-refresh. */}
      <Toast toast={catatan} />
    </div>
  );
}
