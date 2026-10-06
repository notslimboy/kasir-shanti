import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Card, Pill } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import {
  Field,
  PageHeader,
  StatTile,
  Tabs,
  btnGhost,
  btnPrimary,
  inputClass,
} from "@/components/ui/kit";
import type { Customer } from "@/lib/page-data";
import { idNumerikCustomer } from "@/lib/page-data";
import { useData } from "@/lib/data-source";
import { rupiahShort } from "@/lib/format";
import { SortableTh, urutkan, useUrutan } from "@/components/ui/sortable-table";
import { tanggalPendekKeWaktu } from "@/lib/tanggal-pendek";
import { ubahCustomer } from "@/lib/supabase-tulis";
import { galatValidasi, type GalatTulis } from "@/lib/galat-tulis";

/* ==========================================================================
   Data Customer — 318 customer, alias, tag, ongkir default, deposit.
   Fokus: cari cepat, lihat riwayat singkat, dan ubah data tanpa pindah halaman.
   ========================================================================== */

/* Catatan data: kolom customers.tag berisi AREA atau franchise
   (ITS, GOJEK, Sutorejo, Bhaskara, Pakuwon, ...), bukan kategori
   Rumah/Kantor/Kampus. Daftar tag karena itu diambil dari data, bukan
   ditulis di sini — daftar tetap akan salah begitu ada area baru. */

/** Kolom yang bisa diubah kasir. Yang lain dibaca dari riwayat transaksi. */
type Draft = {
  name: string;
  address: string;
  tag: string;
  deposit: number;
  ongkir: number;
  note: string;
};

/** Nilai tag khusus untuk customer tanpa area/franchise. */
const TANPA_TAG = "Tanpa Tag";

/* Nilai yang dipakai `urutkan` untuk tiap kolom.
 *
 * `tag` kosong harus jadi null, bukan "": `urutkan` melempar nilai kosong ke
 * ekor daftar secara terpisah dari arah, jadi "" akan ikut terbawa sebagai
 * nilai terkecil dan menduduki posisi pertama saat urutan naik. 118 dari 318
 * customer tidak punya tag, jadi ini bukan kasus tepi.
 *
 * `terakhir` dikembalikan sebagai Date, bukan string "4 Juli 2026".
 * `localeCompare` akan membandingkan karakter, dan "4 Juli" selalu mendahului
 * "30 September" karena "4" lebih kecil dari "3" — urutan naiknya terbalik.
 * `tanggalPendekKeWaktu` mengubahnya kembali jadi waktu yang bisa dibandingkan. */
function kolomNilai(c: Customer, kolom: string): string | number | Date | null {
  switch (kolom) {
    case "customer":
      return c.name;
    case "tag":
      return c.tag ? c.tag : null;
    case "order":
      return c.orderCount;
    case "total":
      return c.total;
    case "deposit":
      return c.deposit;
    case "terakhir":
      return tanggalPendekKeWaktu(c.lastOrder);
    default:
      return null;
  }
}

export function CustomerPage() {
  const live = useData();

  const daftar = useMemo<Customer[]>(() => live.customers, [live.customers]);

  /* null = belum ada suntingan lokal. Setelah user menyimpan, daftar ini
     dipakai lagi supaya perubahannya tidak hilang kalau data live di-muat
     ulang. */
  const [sunting, setSunting] = useState<Customer[] | null>(null);
  const aktif = sunting ?? daftar;

  const [q, setQ] = useState("");
  const [tag, setTag] = useState("semua");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tersimpan, setTersimpan] = useState(false);
  /* Dua state yang tidak bisa disatukan dengan `tersimpan`: `menyimpan`
     masih ada request yang jalan, `galatSimpan` sudah tahu hasilnya gagal.
     "Tersimpan" hanya boleh tampil setelah server mengonfirmasi. */
  const [menyimpan, setMenyimpan] = useState(false);
  const [galatSimpan, setGalatSimpan] = useState<GalatTulis | null>(null);

  const cocokTag = (c: Customer) =>
    tag === "semua" || (tag === "__tanpa" ? !c.tag : c.tag === tag);

  const { urutan, toggle } = useUrutan();

  /* Saring dulu, baru urutkan — bukan sebaliknya. Urutan bawaan halaman
     ini sudah alphabetic dari server, dan itu yang dilihat kasir sebelum
     menyentuh header apa pun; tahap "lepas" di `arahBerikutnya`
     mengembalikannya ke sana, bukan ke urutan yang lain. */
  const rows = urutkan(
    aktif.filter(
      (c) =>
        cocokTag(c) &&
        (q === "" ||
          c.name.toLowerCase().includes(q.toLowerCase()) ||
          c.address.toLowerCase().includes(q.toLowerCase())),
    ),
    urutan,
    kolomNilai,
  );

  const totalOrder = aktif.reduce((a, c) => a + c.orderCount, 0);

  /* Di Supabase deposit_balance semua customer masih 0. Angka "Rp 750 rb"
     yang dulu dipakai berasal dari data contoh — lebih jujur menampilkan 0
     daripada angka yang tidak ada asalnya. */
  const totalDeposit = aktif.reduce((a, c) => a + (c.deposit || 0), 0);
  const jumlahDeposit = aktif.filter((c) => (c.deposit || 0) > 0).length;

  /* Tag diambil dari data yang tampil. 118 dari 318 customer punya tag
     kosong, jadi "Tanpa Tag" harus jadi pil-nya sendiri, bukan tersembunyi
     di dalam daftar. */
  const opsiTag = useMemo(() => {
    const hitung = new Map<string, number>();
    let tanpaTag = 0;
    for (const c of aktif) {
      if (!c.tag) { tanpaTag += 1; continue; }
      hitung.set(c.tag, (hitung.get(c.tag) ?? 0) + 1);
    }
    const urut = [...hitung.entries()].sort((a, b) => b[1] - a[1]);
    return [
      { id: "semua", label: "Semua", count: aktif.length },
      ...urut.map(([id, n]) => ({ id, label: id, count: n })),
      { id: "__tanpa", label: "Tanpa Tag", count: tanpaTag },
    ];
  }, [aktif]);

  /** Tag unik untuk dropdown editor — minus pil "Semua"/"Tanpa Tag". */
  const opsiTagSrc = useMemo(() => {
    const set = new Set<string>();
    for (const c of aktif) if (c.tag) set.add(c.tag);
    return [...set].sort((a, b) => a.localeCompare(b, "id-ID")).map((t) => ({ value: t, label: t }));
  }, [aktif]);

  const buka = (c: Customer) => {
    setOpenId(c.id);
    setTersimpan(false);
    setDraft({
      name: c.name,
      address: c.address,
      tag: c.tag ?? TANPA_TAG,
      deposit: c.deposit,
      ongkir: c.ongkir,
      note: c.note,
    });
  };

  const tutup = () => {
    setOpenId(null);
    setDraft(null);
  };

  /* Simpan harus sampai ke server dulu, baru ke state lokal.
   *
     Versi sebelumnya hanya memanggil setSunting — tidak ada fetch sama
     sekali. Daftar berubah seketika, jadi kelihatan berhasil, tapi begitu
     halaman dimuat ulang `live.customers` membawa data dari server dan
     semua ketikan hilang. Worse: kasir mengira nomornya sudah tersimpan,
     padahal tidak ada yang berubah di mana pun.
   *
     Urutannya sekarang: tulis ke Supabase, dan hanya kalau hasilnya ok
     daftar lokal ikut berubah. Kalau gagal, drawer tetap terbuka dengan
     pesan errornya — lebih baik kasir melihat kegagalan daripada menyimpan
     optimism yang hilang saat reload. */
  const simpan = async () => {
    if (!draft || !openId || menyimpan) return;

    const dbId = idNumerikCustomer(openId);
    if (dbId === null) {
      setGalatSimpan(
        galatValidasi("Customer ini belum punya id database, jadi tidak bisa disimpan."),
      );
      return;
    }

    setMenyimpan(true);
    setGalatSimpan(null);
    const hasil = await ubahCustomer({
      id: dbId,
      name: draft.name,
      tag: draft.tag === TANPA_TAG ? null : draft.tag,
      deposit: draft.deposit,
      ongkir: draft.ongkir,
    });
    setMenyimpan(false);

    if (!hasil.ok) {
      setGalatSimpan({
        judul: hasil.judul ?? "Gagal menyimpan",
        penjelasan: hasil.penjelasan ?? hasil.pesan,
        langkah: hasil.langkah ?? "Coba lagi. Kalau tetap gagal, hubungi pemilik aplikasi.",
        ...(hasil.teknis ? { teknis: hasil.teknis } : {}),
      });
      return;
    }

    setSunting(
      (all) =>
        (all ?? daftar).map((c) =>
          c.id === openId
            ? {
                ...c,
                name: draft.name.trim() || c.name,
                tag: draft.tag === TANPA_TAG ? null : draft.tag,
                deposit: draft.deposit,
                ongkir: draft.ongkir,
              }
            : c,
        ),
    );
    setTersimpan(true);
    setTimeout(() => {
      setTersimpan(false);
      tutup();
    }, 620);
  };

  return (
    <div>
      <PageHeader
        title="Data Customer"
        sub="Riwayat order, ongkir default, dan deposit per customer."
        action={
          <div className="flex gap-2">
            <button className={btnGhost}>Import</button>
            <button className={btnPrimary}>+ Tambah Customer</button>
          </div>
        }
      />

      {/* 2x2 sejak mobile: 4 kartu menumpuk memanjang tidak lagi jadi
          tempat lewat untuk sampai ke isi halaman. */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Total Customer" value={String(aktif.length)} hint="di Supabase" tone="accent" />
        <StatTile label="Order Aktif" value={String(totalOrder)} hint="30 hari terakhir" />
        <StatTile
          label="Rata-rata Order"
          value={`${aktif.length ? (totalOrder / aktif.length).toFixed(1).replace(".", ",") : "0"}×`}
          hint="per customer"
        />
        <StatTile label="Deposit" value={rupiahShort(totalDeposit)} hint={`${jumlahDeposit} customer`} />
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          {/* `self-start`: Tabs melebar penuh di kolom flex, dan ruang kosong
            setelah tab terakhir terlihat seperti tab yang gagal render.
            `self-start` membuatnya ikut isinya. */}
          <Tabs className="self-start" value={tag} onChange={setTag} items={opsiTag} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau alamat…"
            className={inputClass + " w-full sm:max-w-xs"}
          />
        </div>

        <p className="mb-2 text-xs text-muted-foreground">
          Ketuk baris untuk mengubah data customer.
        </p>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <SortableTh kolom="customer" urutan={urutan} onToggle={toggle}>
                  Customer
                </SortableTh>
                <SortableTh kolom="tag" urutan={urutan} onToggle={toggle}>
                  Tag
                </SortableTh>
                <SortableTh kolom="order" urutan={urutan} onToggle={toggle} align="right">
                  Order
                </SortableTh>
                <SortableTh
                  kolom="total"
                  urutan={urutan}
                  onToggle={toggle}
                  align="right"
                  className="pr-4"
                >
                  Total Belanja
                </SortableTh>
                <SortableTh
                  kolom="deposit"
                  urutan={urutan}
                  onToggle={toggle}
                  align="right"
                  className="pl-4 pr-4"
                >
                  Deposit
                </SortableTh>
                <SortableTh
                  kolom="terakhir"
                  urutan={urutan}
                  onToggle={toggle}
                  className="pl-4"
                >
                  Order Terakhir
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const on = openId === c.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => buka(c)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        buka(c);
                      }
                    }}
                    className={
                      "cursor-pointer border-b border-border transition-colors last:border-0 " +
                      (on ? "bg-accent/40 ring-2 ring-inset ring-primary" : "hover:bg-muted/50")
                    }
                  >
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                          {c.name.slice(0, 2)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{c.address}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      {c.tag ? <Pill>{c.tag}</Pill> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 text-right figure">{c.orderCount}×</td>
                    <td className="py-3 pr-4 text-right font-semibold figure">{rupiahShort(c.total)}</td>
                    <td className="py-3 pl-4 pr-4 text-right figure">
                      {c.deposit > 0 ? (
                        <span className="font-semibold text-[#1F5C4A] dark:text-[#7FD6B4]">
                          {rupiahShort(c.deposit)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pl-4 text-muted-foreground figure">{c.lastOrder}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-muted-foreground">
                    Customer tidak ditemukan
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Kartu customer untuk layar < lg. */}
        <ul className="space-y-2 lg:hidden">
          {rows.map((c) => {
            const on = openId === c.id;
            return (
              <li key={c.id}>
                <div
                  onClick={() => buka(c)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      buka(c);
                    }
                  }}
                  className={
                    "cursor-pointer rounded-2xl border p-3 transition-colors " +
                    (on
                      ? "border-primary bg-accent/40"
                      : "border-border bg-card active:bg-muted/60")
                  }
                >
                  {/* Baris atas: avatar + nama, dengan total belanja di kanan
                      karena itu angka yang paling sering dicari. */}
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                      {c.name.slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.address}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Total
                      </div>
                      <div className="font-bold figure">{rupiahShort(c.total)}</div>
                    </div>
                  </div>

                  {/* Baris bawah: tag, jumlah order, deposit, order
                      terakhir. Metrik kecil dibuat pill supaya tidak
                      jadi kolom tabel yang sempit. */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {c.tag && <Pill>{c.tag}</Pill>}
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold figure">
                      {c.orderCount}× order
                    </span>
                    {c.deposit > 0 && (
                      <span className="rounded-full bg-[#ECF3F1] px-2.5 py-1 text-xs font-semibold text-[#1F5C4A] dark:bg-[#16302A] dark:text-[#7FD6B4] figure">
                        Deposit {rupiahShort(c.deposit)}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground figure">
                      {c.lastOrder}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="rounded-2xl border border-dashed border-input py-12 text-center text-muted-foreground">
              Customer tidak ditemukan
            </li>
          )}
        </ul>
      </Card>

      <Drawer
        open={draft !== null}
        onClose={tutup}
        title="Ubah Data Customer"
        subtitle={draft?.name}
        footer={
          <div className="space-y-2">
            {/* Error tidak pernah disembunyikan di balik "Tersimpan".
                Kegagalan menulis harus kelihatan selama drawenya masih
                terbuka — kalau tidak, kasir menekan Simpan, melihat
               daftar berubah, lalu reload dan menemukan semua hilang. */}
            {/* Error ditampilkan berjenjang, bukan sebagai satu blok merah.
                Yang dibaca kasir cuma judulnya: "Nama itu sudah dipakai".
                Penjelasan dan langkah menyusul, dan detail Postgres yang
                tidak berarti apa-apa bagi kasir disimpan di paling bawah
                dengan huruf kecil — tetap ada untuk developer,
                tapi tidak memenuhi layar. */}
            {galatSimpan && (
              <div
                role="alert"
                className="rounded-2xl bg-destructive/10 px-3.5 py-3 text-destructive"
              >
                <p className="text-sm font-bold">{galatSimpan.judul}</p>
                <p className="mt-1 text-xs">{galatSimpan.penjelasan}</p>
                <p className="mt-1.5 text-xs font-semibold">{galatSimpan.langkah}</p>
                {galatSimpan.teknis && (
                  <p className="mt-2 break-words font-mono text-[10px] opacity-70">
                    {galatSimpan.teknis}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <AnimatePresence mode="wait" initial={false}>
                {tersimpan ? (
                  <motion.span
                    key="ok"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                    className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-bold text-primary-foreground"
                  >
                    ✓ Tersimpan
                  </motion.span>
                ) : menyimpan ? (
                  <motion.span
                    key="jalan"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="inline-flex h-11 items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground"
                  >
                    Menyimpan…
                  </motion.span>
                ) : null}
              </AnimatePresence>
              <button
                onClick={tutup}
                disabled={tersimpan || menyimpan}
                className={btnGhost + " disabled:opacity-40"}
              >
                Batal
              </button>
              <motion.button
                onClick={simpan}
                disabled={tersimpan || menyimpan}
                whileTap={{ scale: 0.96 }}
                className={btnPrimary + " disabled:opacity-40"}
              >
                Simpan
              </motion.button>
            </div>
          </div>
        }
      >
        {draft && (
          <div className="space-y-3">
            <Field label="Nama Customer">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputClass}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Area / Franchise" hint="Dipakai untuk mengelompokkan, bukan kategori">
                <Select
                  value={draft.tag}
                  onChange={(tag) => setDraft({ ...draft, tag })}
                  options={[...opsiTagSrc, { value: TANPA_TAG, label: TANPA_TAG }]}
                />
              </Field>
              <Field label="Ongkir Default" hint="terisi otomatis di Kasir">
                <input
                  type="number"
                  value={draft.ongkir || ""}
                  onChange={(e) => setDraft({ ...draft, ongkir: Number(e.target.value) || 0 })}
                  className={inputClass + " figure"}
                />
              </Field>
            </div>
            <Field label="Deposit" hint="Potongan pembayaran di muka">
              <input
                type="number"
                value={draft.deposit || ""}
                onChange={(e) => setDraft({ ...draft, deposit: Number(e.target.value) || 0 })}
                className={inputClass + " figure"}
              />
            </Field>

            {/* Tabel customers hanya punya 8 kolom: id, name,
                default_shipping, last_order_at, created_at, updated_at,
                deposit_balance, tag. Tidak ada kolom alamat maupun catatan —
                jadi field-nya tidak ditampilkan. Menampilkannya berarti
                kasir mengetik sesuatu yang nowhere-to-go. */}
            {live.status === "live" && (
              <p className="rounded-2xl bg-muted px-3.5 py-2.5 text-xs text-muted-foreground">
                Supabase belum punya kolom alamat dan catatan untuk customer.
                Alamat tersimpan di tiap struk, jadi ubah dari menu Penjualan
                bila perlu.
              </p>
            )}

            <p className="rounded-2xl bg-muted px-3.5 py-2.5 text-xs text-muted-foreground">
              Riwayat order tidak bisa diubah dari sini — hapus struknya di menu Penjualan kalau
              ada yang keliru.
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
