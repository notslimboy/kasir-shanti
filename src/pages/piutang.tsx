import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { useData } from "@/lib/data-source";
import { kurirDariTag, petaTag, TAG_TANPA_PEMETAAN } from "@/lib/kurir";
import { rupiah, rupiahShort } from "@/lib/format";
import { Card, Pill } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { Toast, useToast } from "@/components/ui/toast";
import { PageHeader, StatTile, Tabs, btnGhost, inputClass } from "@/components/ui/kit";
import { delayDaftar } from "@/components/list-motion";
import {
  ambilDetailPiutang,
  filterPiutang,
  formatNominal,
  keNominal,
  sisaPiutang,
  statusPiutang,
  totalSisaPiutang,
  type BarisPiutang,
  type DetailPiutang,
} from "@/lib/piutang";
import { batalkanLunasPiutang, catatPembayaranPiutang } from "@/lib/piutang-tulis";
import type { SaleRow } from "@/supabase/types";

/* ==========================================================================
   Catatan Piutang — tagihan yang belum / sebagian lunas, plus deposit.

   Mekanismenya sama dengan versi lama (script.js):
     - cicilan dicatat di tabel `sale_payments`, `paid_amount` naik sebesar sisa
       yang tertangani, dan kelebihan bayar masuk deposit customer
     - "Lunas" = bayar penuh sisa; "Belum lunas" = hapus riwayat pembayaran
       dan mengembalikan efek depositnya
     - bisa banyak struk sekaligus, dengan progres per struk

   Sumber datanya SELURUH riwayat struk, bukan rentang tanggal yang sedang
   dibuka di Penjualan — piutang tidak cares tanggal filter halaman lain.
   ========================================================================== */

const STATUS_TONE = {
  belum: "danger",
  sebagian: "warning",
  lunas: "success",
  terhapus: "neutral",
} as const satisfies Record<string, "danger" | "warning" | "success" | "neutral">;

const STATUS_LABEL = {
  belum: "Belum Lunas",
  sebagian: "Sebagian",
  lunas: "Lunas",
  terhapus: "Dibatalkan",
} as const;

const MS_HARI = 86_400_000;

/* Berapa banyak baris yang boleh dirender sekaligus.

   100 bukan angka magic: ini titik di mana satu batch render masih
   murah di HP kelas bawah, sementara tabel piutang bisa berisi ratusan
   struk. Render semuanya sekaligus bikin halaman berat dan mengetik di
   kolom cari ikut tersendat — bukan karena filter-nya mahal, tapi
   karena ada ratusan baris yang di-paint ulang tiap ketikan. */
const UKURAN_HALAMAN = 100;

/** Umur tagihan dalam hari, dihitung dari tengah malam tanggal struk. */
function umurHari(completedAt: string): number {
  const tgl = String(completedAt || "").slice(0, 10);
  const mulai = new Date(`${tgl}T00:00:00`).getTime();
  if (Number.isNaN(mulai)) return 0;
  return Math.max(0, Math.floor((Date.now() - mulai) / MS_HARI));
}

/** "2 Okt 2026" — tanggal struk, bukan tanggal hari ini.
 *
 * Tanggal dari server sudah dipangkas jadi YYYY-MM-DD. `new Date("2026-10-02")`
 * dibaca sebagai tengah malam UTC, dan di WIB itu 01.00 — tanggalnya bergeser
 * sehari. Jadi tanggal murni dikunci ke tengah malam lokal. */
function tanggalPendek(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

/** "2 Okt 2026, 10.15" — dipakai di detail. */
function tanggalPanjang(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function keBaris(s: SaleRow, tag: (nama: string) => string): BarisPiutang {
  const customer = String(s.customer_name || "Tanpa Nama");
  const t = tag(customer);
  return {
    saleId: s.id,
    customer,
    tag: t,
    invoice: s.receipt_no,
    date: String(s.completed_at || "").slice(0, 10),
    total: Number(s.total || 0),
    paid: Number(s.paid_amount || 0),
    sisa: Math.max(0, sisaPiutang(s)),
    status: statusPiutang(s),
    courier: kurirDariTag(t) || TAG_TANPA_PEMETAAN,
    umurHari: umurHari(s.completed_at),
  };
}

export function PiutangPage() {
  const data = useData();
  const [tab, setTab] = useState("belum");
  const [q, setQ] = useState("");
  const [terpilih, setTerpilih] = useState<number[]>([]);
  const [sibuk, setSibuk] = useState<number | null>(null);
  const [menyimpanSemua, setMenyimpanSemua] = useState(false);
  const [progres, setProgres] = useState<{ selesai: number; total: number; label: string } | null>(null);
  const [bayar, setBayar] = useState<BarisPiutang | null>(null);
  const [nominal, setNominal] = useState("");
  const [konfirmasi, setKonfirmasi] = useState<{
    judul: string;
    subjudul?: string;
    jalankan: () => void;
  } | null>(null);
  const [detail, setDetail] = useState<{ baris: BarisPiutang; isi: DetailPiutang | null } | null>(null);
  const [toast, setToast] = useToast();

  /* Berapa baris yang sudah dirender. Bukan pagination: tidak ada nomor
     halaman, tidak ada tombol "back", dan posisi scroll tidak melompat
     saat halaman dimuat — yang ditambahkan hanya BELAKANG daftar, jadi
     yang sedang dibaca user tetap di tempat. */
  const [tampil, setTampil] = useState(UKURAN_HALAMAN);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const kurangiGerak = useReducedMotion();

  const tagUntukNama = useMemo(
    () => petaTag(data.customers.map((c) => ({ name: c.name, tag: c.tag }))),
    [data.customers],
  );

  /* Struk terhapus TIDAK pernah jadi piutang — sama seperti versi lama.
     `deleted_at` berarti struk di-void, bukan tagihan yang belum dibayar. */
  const semua = useMemo(
    () => data.salesSemua.filter((s) => !s.deleted_at).map((s) => keBaris(s, tagUntukNama)),
    [data.salesSemua, tagUntukNama],
  );

  const rows = useMemo(() => filterPiutang(semua, tab, q), [semua, tab, q]);

  /* Baris yang benar-benar dirender: `rows` dipotong jadi `tampil`.

     Dipotong, bukan disaring: `rows` tetap memuat seluruh hasil filter,
     jadi "Pilih semua" masih menagih semua tagihan yang cocok — bukan
     cuma 100 yang kebetulan sudah terlihat. */
  const terlihat = useMemo(() => rows.slice(0, tampil), [rows, tampil]);
  const sisa = rows.length - terlihat.length;

  /* Kembali ke halaman pertama kalau filter berubah (ganti tab, ketik
     di kolom cari) atau datanya diganti. Tanpa ini, buka tab "Semua"
     setelah menjelajah 300 baris akan langsung me-render 300 baris
     lagi — persis lag yang harus dihindari.

     dependensi `rows` (bukan `tab`/`q`): `rows` adalah hasil filter,
     jadi satu perubahan sudah mencakup ganti tab, ubah pencarian, dan
     data baru dari server, tanpa perlu mendaftarkan tiap sumbernya. */
  useEffect(() => {
    setTampil(UKURAN_HALAMAN);
  }, [rows]);

  /* Muat 100 berikutnya saat sentinel menyentuh viewport.

     `rootMargin` 600px = mulai memuat sebelum benar-benar sampai
     ujung, jadi baris baru sudah ada saat jari berhenti — tidak ada
     "tunggu kosong dulu" di layar.

     Sentinel HANYA dirender kalau masih ada sisa baris. Begitu
     `sisa` habis, node-nya hilang, observer-nya tidak terlihat lagi,
     dan tidak ada lagi yang memicu `setTampil`. Ini yang mencegah
     loop tak berujung. */
  useEffect(() => {
    if (sisa <= 0) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setTampil((t) => Math.min(t + UKURAN_HALAMAN, rows.length));
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sisa, rows.length]);

  /* Semua agregat di bawah di-memo.

     Semuanya menyapu SELURUH riwayat struk. Tanpa memo, tiap ketikan di
     kolom cari dan tiap centang checkbox menjalankan ulang semua
     `.filter`/`.reduce` itu — dan itulah sumber "ngelag saat ngetik",
     jauh sebelum daftar ikut banyak. Memo menguncinya ke `semua`, jadi
     perhitungan hanya jalan ulang saat datanya memang berubah. */
  const belumLunas = useMemo(
    () => semua.filter((b) => b.status !== "lunas" && b.status !== "terhapus"),
    [semua],
  );
  const totalPiutang = useMemo(() => totalSisaPiutang(semua), [semua]);
  const totalTagihan = useMemo(() => belumLunas.reduce((a, b) => a + b.total, 0), [belumLunas]);
  const rataUmur = useMemo(
    () =>
      belumLunas.length
        ? Math.round(belumLunas.reduce((a, b) => a + b.umurHari, 0) / belumLunas.length)
        : 0,
    [belumLunas],
  );
  const lewatTempo = useMemo(() => belumLunas.filter((b) => b.umurHari > 14).length, [belumLunas]);
  const totalDeposit = useMemo(
    () => data.customers.reduce((a, c) => a + (c.deposit || 0), 0),
    [data.customers],
  );
  const jumlahDeposit = useMemo(
    () => data.customers.filter((c) => (c.deposit || 0) > 0).length,
    [data.customers],
  );
  const hitunganTab = useMemo(
    () => ({
      belum: semua.filter((b) => b.status !== "lunas").length,
      lunas: semua.filter((b) => b.status === "lunas").length,
      semua: semua.length,
    }),
    [semua],
  );

  /* `terpilih` dipakai di dalam loop render tiap baris. `includes` di
     array membuat tiap baris menyisir seluruh pilihan — jadi sekali
     "Pilih semua" yang memuat ratusan struk, tiap baris menyisir
     ratusan isi. Set membuat cek itu O(1). */
  const terpilihSet = useMemo(() => new Set(terpilih), [terpilih]);

  /* Detail diambil saat modal dibuka, bukan ikut daftar. Tabel piutang bisa
     berisi ratusan struk dan setiap struk punya baris item sendiri. */
  useEffect(() => {
    const id = detail?.baris.saleId;
    if (id === undefined || detail?.isi) return;
    let batal = false;
    void ambilDetailPiutang(id)
      .then((isi) => {
        if (batal) return;
        setDetail((d) => (d && d.baris.saleId === id ? { ...d, isi } : d));
      })
      .catch((e: Error) => {
        if (!batal) setToast({ tone: "warn", text: `Detail gagal dimuat: ${e.message}` });
      });
    return () => {
      batal = true;
    };
    /* `isi` ikut jadi dependensi: baris yang sama dibuka lagi dengan isi
       yang sudah ada tidak boleh menarik ulang. */
  }, [detail?.baris.saleId, detail?.isi]);

  /* ---------------------------------------------------------------------
     Menulis. Setelah berhasil, data inti ditarik ulang PAKEA: `salesSemua`
     dibaca dari cache inti, dan cache itu masih berisi paid_amount lama —
     jadi tanpa refresh, tabel tetap menampilkan sisa yang barusan lunas.
     --------------------------------------------------------------------- */
  const setelahTulis = async (pesan: { tone: "ok" | "warn"; text: string }) => {
    setToast(pesan);
    await data.perbaruiSetelahTulis();
  };

  const bayarSatu = async (baris: BarisPiutang, amount: number, note: string) => {
    setSibuk(baris.saleId);
    try {
      const hasil = await catatPembayaranPiutang(baris.saleId, amount, note);
      if (!hasil.ok) {
        setToast({ tone: "warn", text: hasil.pesan });
        return false;
      }
      await setelahTulis({
        tone: "ok",
        text:
          hasil.deposit > 0
            ? `${baris.invoice}: ${rupiah(amount)} dicatat, ${rupiah(hasil.deposit)} masuk deposit.`
            : `${baris.invoice}: pembayaran ${rupiah(amount)} tersimpan.`,
      });
      return true;
    } finally {
      setSibuk(null);
    }
  };

  const batalkanSatu = async (baris: BarisPiutang) => {
    setSibuk(baris.saleId);
    try {
      const hasil = await batalkanLunasPiutang(baris.saleId);
      if (!hasil.ok) {
        setToast({ tone: "warn", text: hasil.pesan });
        return false;
      }
      await setelahTulis({ tone: "ok", text: `${baris.invoice} dikembalikan ke Belum Lunas.` });
      return true;
    } finally {
      setSibuk(null);
    }
  };

  const bukaBayar = (baris: BarisPiutang) => {
    setBayar(baris);
    setNominal(formatNominal(baris.sisa));
  };

  const submitBayar = async () => {
    if (!bayar) return;
    const amount = keNominal(nominal);
    if (amount <= 0) {
      setToast({ tone: "warn", text: "Nominal pembayaran tidak valid." });
      return;
    }
    const ok = await bayarSatu(bayar, amount, "Pembayaran cicilan manual");
    if (ok) setBayar(null);
  };

  /* ---------------------------------------------------------------------
     Aksi massal. Satu per satu, bukan Promise.all: setiap structs menulis ke
     deposit customer yang sama, jadi dua penulisan yang tumpang tindih bisa
     saling menimpa saldo.
     --------------------------------------------------------------------- */
  const bulk = async (aksi: "lunas" | "belum") => {
    const target = semua.filter(
      (b) => terpilih.includes(b.saleId) && (aksi === "lunas" ? b.sisa > 0 : b.paid > 0),
    );
    if (!target.length) {
      setToast({
        tone: "warn",
        text: aksi === "lunas" ? "Semua pilihan sudah lunas." : "Tidak ada pembayaran yang perlu dibatalkan.",
      });
      return;
    }
    setKonfirmasi(null);
    setMenyimpanSemua(true);
    const label = aksi === "lunas" ? "Melunaskan" : "Mengubah status";
    setProgres({ selesai: 0, total: target.length, label });
    let gagal = 0;
    try {
      for (let i = 0; i < target.length; i += 1) {
        const b = target[i];
        const hasil =
          aksi === "lunas"
            ? await catatPembayaranPiutang(b.saleId, b.sisa, "Pelunasan bulk")
            : await batalkanLunasPiutang(b.saleId);
        if (!hasil.ok) gagal += 1;
        setProgres({ selesai: i + 1, total: target.length, label });
      }
      setTerpilih([]);
      await setelahTulis({
        tone: gagal ? "warn" : "ok",
        text: gagal
          ? `${target.length - gagal} transaksi berhasil, ${gagal} gagal.`
          : aksi === "lunas"
            ? `${target.length} transaksi ditandai lunas.`
            : `${target.length} transaksi diubah ke Belum Lunas.`,
      });
    } finally {
      setProgres(null);
      setMenyimpanSemua(false);
    }
  };

  /* "Pilih semua" sengaja membaca `rows` (semua hasil filter), bukan
     `terlihat`. Kalau ikut dipotong, memilih semua di tab yang belum
     ter-load 300 baris hanya akan menagih 100 baris pertama — dan
     konteks "Lunas" di toolbar jadi menipu. */
  const bisaPilih = useMemo(
    () => rows.filter((b) => b.status !== "terhapus"),
    [rows],
  );
  const semuaTerpilih = bisaPilih.length > 0 && bisaPilih.every((b) => terpilihSet.has(b.saleId));

  return (
    <div>
      <PageHeader
        title="Catatan Piutang"
        sub="Tagihan yang belum lunas, sisa pembayaran, dan deposit customer."
        action={
          <button
            className={btnGhost}
            onClick={() => void data.perbaruiSetelahTulis()}
            disabled={data.status === "memuat"}
          >
            Muat ulang
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Total Piutang"
          value={rupiahShort(totalPiutang)}
          hint={`${belumLunas.length} tagihan`}
          tone="accent"
        />
        <StatTile
          label="Tagihan Berjalan"
          value={rupiahShort(totalTagihan)}
          hint={`sisa ${rupiahShort(totalPiutang)}`}
          tone="warn"
        />
        <StatTile
          label="Rata-rata Umur"
          value={`${rataUmur} hari`}
          hint={`${lewatTempo} lewat 14 hari`}
          tone="danger"
        />
        <StatTile
          label="Deposit Masuk"
          value={rupiahShort(totalDeposit)}
          hint={`${jumlahDeposit} customer`}
        />
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <Tabs
            className="self-start"
            value={tab}
            onChange={(id) => {
              setTab(id);
              setTerpilih([]);
            }}
            items={[
              { id: "belum", label: "Belum Lunas", count: hitunganTab.belum },
              { id: "lunas", label: "Lunas", count: hitunganTab.lunas },
              { id: "semua", label: "Semua", count: hitunganTab.semua },
            ]}
          />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setTerpilih([]);
            }}
            placeholder="Cari customer / nomor struk…"
            className={inputClass + " w-full sm:max-w-xs"}
          />
        </div>

        {/* Aksi massal — mirrors toolbar versi lama: pilih beberapa struk
            lalu lunaskan atau kembalikan sekaligus. */}
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-muted/60 px-3 py-2">
          {/* Tri-state: sebagian baris terpilih -> kotak setengah. Tanpa itu,
              centang penuh berarti "semua dipilih" padahal tidak, dan itu
              sumber salah pilih saat akan melunasi banyak struk. */}
          <label className="flex items-center gap-2 text-sm font-semibold">
            <Checkbox
              ukuran="md"
              label="Pilih semua piutang yang bisa dipilih"
              checked={semuaTerpilih}
              indeterminate={terpilih.length > 0 && !semuaTerpilih}
              onChange={(v) => setTerpilih(v ? bisaPilih.map((b) => b.saleId) : [])}
            />
            Pilih semua ({bisaPilih.length})
          </label>
          <span className="text-xs text-muted-foreground figure">
            {terpilih.length ? `${terpilih.length} dipilih` : "Belum ada yang dipilih"}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => void bulk("lunas")}
              disabled={terpilih.length === 0 || menyimpanSemua}
              className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              Lunas
            </button>
            <button
              onClick={() =>
                setKonfirmasi({
                  judul: "Ubah pilihan jadi Belum Lunas?",
                  subjudul: `${terpilih.length} transaksi terpilih`,
                  jalankan: () => void bulk("belum"),
                })
              }
              disabled={terpilih.length === 0 || menyimpanSemua}
              className="h-9 rounded-full border border-input px-4 text-xs font-semibold text-destructive disabled:opacity-40"
            >
              Belum lunas
            </button>
          </div>
        </div>

        {progres && (
          <div className="mb-3" aria-live="polite">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.round((progres.selesai / progres.total) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground figure">
              {progres.label} {progres.selesai}/{progres.total}
            </p>
          </div>
        )}

        {/* 9 kolom min-w 960px = tabel 2,5x lebar layar HP. Di bawah lg
            tabel disembunyikan, diganti kartu: tagihan sudah jadi kartu
            fisik yang dibawa kurir, jadi bentuk daftar di layar seharusnya
            mengikuti bentuk itu, bukan tabel yang digeser. */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="w-8 pb-2">
                  <span className="sr-only">Pilih</span>
                </th>
                <th className="pb-2 font-semibold">Customer</th>
                <th className="pb-2 font-semibold">No. Struk</th>
                <th className="pb-2 font-semibold">Tanggal</th>
                <th className="pb-2 pr-4 text-right font-semibold">Tagihan</th>
                <th className="pb-2 pr-4 text-right font-semibold">Dibayar</th>
                <th className="pb-2 pr-4 text-right font-semibold">Sisa</th>
                <th className="pb-2 pl-4 font-semibold">Status</th>
                <th className="pb-2 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {terlihat.map((p, i) => {
                const lewat = p.umurHari > 14;
                const dipilih = terpilihSet.has(p.saleId);
                /* Batch pertama (indeks < 100) TIDAK beranimasi; batch
                   susulan yang dimuat sambil scroll yang iya.

                   Alasannya sama dengan catatan di list-motion.tsx:
                   seratus elemen yang mount sekaligus sambil beranimasi
                   menahan render pertama — persis yang membuat halaman ini
                   terasa berat. Yang perlu terlihat gerak hanyalah baris
                   yang benar-benar baru masuk karena user menggulir.

                   Penentuannya indeks, bukan state: indeks 0-99 selalu
                   "batch awal" apa pun yang terjadi, jadi tidak ada animasi
                   yang bocor ke render pertama maupun ke penggantian
                   filter. */
                const susulan = i >= UKURAN_HALAMAN;
                return (
                  <motion.tr
                    key={p.saleId}
                    initial={susulan && !kurangiGerak ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: susulan && !kurangiGerak ? 0.18 : 0,
                      delay: susulan ? delayDaftar(i - UKURAN_HALAMAN, kurangiGerak) : 0,
                    }}
                    onClick={() => setDetail({ baris: p, isi: null })}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail({ baris: p, isi: null });
                      }
                    }}
                    className={"cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 " +
                      (dipilih ? "bg-muted/70" : "")}
                  >
                    <td className="py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        label={"Pilih piutang " + p.invoice + " - " + p.customer}
                        checked={dipilih}
                        onChange={(v) =>
                          setTerpilih((t) =>
                            v ? [...t, p.saleId] : t.filter((id) => id !== p.saleId),
                          )
                        }
                      />
                    </td>
                    <td className="py-3">
                      <div className="font-semibold">{p.customer}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.tag} · {p.courier}
                      </div>
                    </td>
                    <td className="py-3 figure text-muted-foreground">{p.invoice}</td>
                    <td className="py-3">
                      <div className="figure">{tanggalPendek(p.date)}</div>
                      <div className={"text-xs figure " + (lewat ? "text-destructive" : "text-muted-foreground")}>
                        {p.umurHari} hari
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right figure">{rupiah(p.total)}</td>
                    <td className="py-3 pr-4 text-right figure text-muted-foreground">{rupiah(p.paid)}</td>
                    <td className="py-3 pr-4 text-right font-bold figure">{rupiah(p.sisa)}</td>
                    <td className="py-3 pl-4">
                      <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>
                    </td>
                    <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {p.status === "lunas" || p.status === "terhapus" ? (
                        <button
                          onClick={() =>
                            setKonfirmasi({
                              judul: "Kembalikan ke Belum Lunas?",
                              subjudul: `${p.invoice} · ${p.customer}`,
                              jalankan: () => void batalkanSatu(p),
                            })
                          }
                          disabled={sibuk === p.saleId || menyimpanSemua}
                          className="h-8 rounded-full border border-input px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                        >
                          Belum lunas
                        </button>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => bukaBayar(p)}
                            disabled={sibuk === p.saleId || menyimpanSemua}
                            className="h-8 rounded-full border border-input px-3 text-xs font-semibold transition-colors hover:border-primary disabled:opacity-40"
                          >
                            Catat bayar
                          </button>
                          <button
                            onClick={() => void bayarSatu(p, p.sisa, "Pelunasan cepat")}
                            disabled={sibuk === p.saleId || menyimpanSemua}
                            className="h-8 rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground transition-opacity disabled:opacity-40"
                          >
                            {sibuk === p.saleId ? "..." : "Lunas"}
                          </button>
                        </div>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-14 text-center text-muted-foreground">
                    {q.trim()
                      ? `Tidak ada piutang yang cocok dengan "${q.trim()}".`
                      : "Tidak ada tagihan di filter ini."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Kartu piutang untuk layar < lg (HP DAN tablet — keduanya
            dapat versi kartu, jadi infar trigger di bawah berlaku sama
            untuk dua platform itu, bukan cuma HP). */}
        <ul className="space-y-2.5 lg:hidden">
          {terlihat.map((p, i) => {
            const lewat = p.umurHari > 14;
            const dipilih = terpilihSet.has(p.saleId);
            /* Aturan sama persis dengan tabel: hanya batch susulan yang
               beranimasi. Bedanya di sini `y` boleh dipakai — kartu
               bukan elemen tabel, jadi menggeser posisinya aman dan
               hasilnya terlihat benar-benar naik dari bawah. */
            const susulan = i >= UKURAN_HALAMAN;
            return (
              <motion.li
                key={p.saleId}
                initial={susulan && !kurangiGerak ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: susulan && !kurangiGerak ? 0.18 : 0,
                  delay: susulan ? delayDaftar(i - UKURAN_HALAMAN, kurangiGerak) : 0,
                }}
                onClick={() => setDetail({ baris: p, isi: null })}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetail({ baris: p, isi: null });
                  }
                }}
                className={
                  "cursor-pointer rounded-2xl border border-border bg-card p-3 " +
                  "transition-colors active:bg-muted/60 " +
                  (dipilih ? "border-primary bg-muted/70" : "")
                }
              >
                {/* Baris atas: centang + customer + sisa tagihan.
                    Sisa adalah angka yang dicari, jadi paling besar dan
                    paling kanan — posisinya sama dengan kolom "Sisa" di
                    tabel, jadi mata tidak perlu belajar ulang. */}
                <div className="flex items-center gap-2.5">
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      label={"Pilih piutang " + p.invoice + " - " + p.customer}
                      checked={dipilih}
                      onChange={(v) =>
                        setTerpilih((t) =>
                          v ? [...t, p.saleId] : t.filter((id) => id !== p.saleId),
                        )
                      }
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.customer}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.invoice} · {p.tag} · {p.courier}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Sisa
                    </div>
                    <div className="text-base font-bold figure">{rupiah(p.sisa)}</div>
                  </div>
                </div>

                {/* Baris tengah: rincian tagih/dibayar + umur. */}
                <dl className="mt-2.5 grid grid-cols-3 gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Tagihan</dt>
                    <dd className="font-semibold figure">{rupiah(p.total)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Dibayar</dt>
                    <dd className="font-semibold figure">{rupiah(p.paid)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Umur</dt>
                    <dd
                      className={
                        "font-semibold figure " +
                        (lewat ? "text-destructive" : "text-foreground")
                      }
                    >
                      {tanggalPendek(p.date)} · {p.umurHari} hr
                    </dd>
                  </div>
                </dl>

                {/* Baris bawah: status + aksi. */}
                <div className="mt-2.5 flex items-center gap-2">
                  <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>
                  <div
                    className="ml-auto flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.status === "lunas" || p.status === "terhapus" ? (
                      <button
                        onClick={() =>
                          setKonfirmasi({
                            judul: "Kembalikan ke Belum Lunas?",
                            subjudul: `${p.invoice} · ${p.customer}`,
                            jalankan: () => void batalkanSatu(p),
                          })
                        }
                        disabled={sibuk === p.saleId || menyimpanSemua}
                        className="h-9 rounded-full border border-input px-3 text-xs font-semibold text-muted-foreground transition-colors active:text-foreground disabled:opacity-40"
                      >
                        Belum lunas
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => bukaBayar(p)}
                          disabled={sibuk === p.saleId || menyimpanSemua}
                          className="h-9 rounded-full border border-input px-3 text-xs font-semibold text-muted-foreground transition-colors active:border-primary disabled:opacity-40"
                        >
                          Catat bayar
                        </button>
                        <button
                          onClick={() => void bayarSatu(p, p.sisa, "Pelunasan cepat")}
                          disabled={sibuk === p.saleId || menyimpanSemua}
                          className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground transition-opacity disabled:opacity-40"
                        >
                          {sibuk === p.saleId ? "..." : "Lunas"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </motion.li>
            );
          })}
          {rows.length === 0 && (
            <li className="rounded-2xl border border-dashed border-input py-12 text-center text-muted-foreground">
              {q.trim()
                ? `Tidak ada piutang yang cocok dengan "${q.trim()}".`
                : "Tidak ada tagihan di filter ini."}
            </li>
          )}
        </ul>

        {/* Penanda posisi + penanda jumlah.

            Letak node ini penting: DI LUAR kedua cabang daftar, di
            bawahnya. Kalau sentinel diletakkan di dalam `<ul>` kartu
            atau di dalam `<table>`, dia ikut `display: none` saat
            breakpoint-nya tidak aktif — dan `display: none` berarti
            `IntersectionObserver` tidak pernah melihatnya, sehingga
            scroll tidak memuat apa-apa di salah satu dari dua mode
            tampilan. Di luar keduanya, node ini selalu tampil, jadi
            satu trigger berlaku untuk desktop (tabel), tablet, dan HP
            (kartu) tanpa perlu logika ganda.

            `sisa` di atas sudah embody jumlah baris yang belum
            dirender, jadi teks di bawah tidak perlu menghitung ulang. */}
        <div ref={sentinelRef} aria-hidden="true" className={sisa > 0 ? "h-px w-full" : "hidden"} />
        {rows.length > 0 && (
          <p className="mt-3 text-center text-xs text-muted-foreground figure" aria-live="polite">
            {sisa > 0
              ? `Menampilkan ${terlihat.length} dari ${rows.length} — gulir untuk memuat lagi`
              : `Semua ${rows.length} tagihan sudah ditampilkan`}
          </p>
        )}
      </Card>

      {/* ---- Catat pembayaran ------------------------------------------- */}

      <Modal
        open={bayar !== null}
        onClose={() => setBayar(null)}
        title="Catat pembayaran"
        subtitle={bayar ? `${bayar.invoice} · ${bayar.customer}` : undefined}
        footer={
          <div className="flex gap-2">
            <button className={btnGhost + " flex-1"} onClick={() => setBayar(null)}>
              Batal
            </button>
            <button
              className="h-11 flex-1 rounded-full bg-primary px-4 font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
              onClick={() => void submitBayar()}
              disabled={sibuk === bayar?.saleId}
            >
              {sibuk === bayar?.saleId ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        }
      >
        {bayar && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-4 py-3">
              <span className="text-sm text-muted-foreground">Sisa tagihan</span>
              <span className="text-lg font-bold figure">{rupiah(bayar.sisa)}</span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Nominal bayar
              </span>
              <input
                className={inputClass + " figure"}
                inputMode="numeric"
                value={nominal}
                onChange={(e) => setNominal(formatNominal(keNominal(e.target.value)))}
                placeholder="50.000"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setNominal(formatNominal(Math.round(bayar.sisa / 2)))}
                className={btnGhost + " h-9 px-4 text-xs"}
              >
                Separuh · {rupiah(Math.round(bayar.sisa / 2))}
              </button>
              <button
                onClick={() => setNominal(formatNominal(bayar.sisa))}
                className={btnGhost + " h-9 px-4 text-xs"}
              >
                Penuh · {rupiah(bayar.sisa)}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Kelebihan dari sisa tagihan otomatis masuk deposit customer, jadi nominal boleh lebih
              besar dari sisa.
            </p>
          </div>
        )}
      </Modal>

      {/* ---- Kembalikan ke belum lunas ---------------------------------- */}

      <Modal
        open={konfirmasi !== null}
        onClose={() => setKonfirmasi(null)}
        title={konfirmasi?.judul ?? ""}
        subtitle={konfirmasi?.subjudul}
        footer={
          <div className="flex gap-2">
            <button className={btnGhost + " flex-1"} onClick={() => setKonfirmasi(null)}>
              Batal
            </button>
            <button
              className="h-11 flex-1 rounded-full bg-destructive px-4 font-semibold text-white transition-opacity disabled:opacity-50"
              disabled={menyimpanSemua}
              onClick={() => {
                konfirmasi?.jalankan();
                setKonfirmasi(null);
              }}
            >
              {menyimpanSemua ? "Memproses..." : "Ya, kembalikan"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          Seluruh riwayat pembayaran struk ini akan dihapus dan tagihannya kembali jadi utuh. Saldo
          deposit customer disesuaikan otomatis kalau ada pembayaran yang pernah memakai deposit.
        </p>
      </Modal>

      {/* ---- Detail transaksi ------------------------------------------- */}

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? detail.baris.invoice : ""}
        subtitle={detail ? `${detail.baris.customer} · ${tanggalPendek(detail.baris.date)}` : undefined}
        size="sm:max-w-2xl"
      >
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tagihan</div>
                <div className="font-bold figure">{rupiah(detail.baris.total)}</div>
              </div>
              <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Dibayar</div>
                <div className="font-bold figure">{rupiah(detail.baris.paid)}</div>
              </div>
              <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sisa</div>
                <div className="font-bold figure">{rupiah(detail.baris.sisa)}</div>
              </div>
            </div>

            <section>
              <h3 className="mb-2 text-sm font-bold">Item pesanan</h3>
              {!detail.isi ? (
                <p className="text-sm text-muted-foreground">Memuat rincian item…</p>
              ) : detail.isi.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada rincian item.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.isi.items.map((it) => {
                    const meta = [it.variant_name, it.note].filter(Boolean).join(" / ");
                    return (
                      <li key={it.id} className="flex items-start justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
                        <span>
                          <span className="font-semibold figure">{it.quantity}x</span>{" "}
                          {it.name}
                          {meta && <small className="ml-1 text-muted-foreground">{meta}</small>}
                        </span>
                        <span className="figure">{rupiah(Number(it.line_total || 0))}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold">Riwayat pembayaran</h3>
              {!detail.isi ? (
                <p className="text-sm text-muted-foreground">Memuat riwayat…</p>
              ) : detail.isi.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada pembayarancicilan.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.isi.payments.map((pay) => (
                    <li key={pay.id} className="flex items-start justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
                      <span>
                        <span className="figure">{tanggalPanjang(pay.payment_date || pay.created_at)}</span>
                        {pay.note && <small className="ml-1 text-muted-foreground">({pay.note})</small>}
                      </span>
                      <span className="font-semibold figure">+ {rupiah(Number(pay.amount || 0))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>

      <Toast toast={toast} />
    </div>
  );
}