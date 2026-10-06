import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Drawer } from "@/components/ui/drawer";
import { Struk, type StrukHandle } from "@/components/struk";
import { Pill } from "@/components/ui/card";
import { btnGhost, btnPrimary, inputClass } from "@/components/ui/kit";
import { IkonAksi, IkonHapusPermanen, IkonRestore } from "@/components/ui/ikon-aksi";
import { rupiah } from "@/lib/format";
import { formatRupiah } from "@/lib/struk";
import { useSetelan } from "@/lib/setelan";
import type { HasilUbah, UbahStrukInput } from "@/lib/supabase-tulis";
import { InputRupiah } from "@/components/ui/input-rupiah";
import type { Sale } from "@/lib/sale";

/* ==========================================================================
   Detail Struk — drawer yang dibuka dari tabel Detail Struk.

   Isinya tiga hal yang selalu ditanyakan: apa saja yang dibeli, uangnya
   bagaimana, dan siapa yang mengantar. Aksi edit/cetak ulang duduk di kaki
   drawer, tidak di dalam daftar, supaya tabelnya tetap ringkas.
   ========================================================================== */

const STATUS_TONE = { lunas: "success", belum: "warning", terhapus: "danger" } as const;
const STATUS_LABEL = { lunas: "Lunas", belum: "Belum Lunas", terhapus: "Dihapus" } as const;

/* -------------------------------------------------------------------------
   Form Ubah Data

   `sendNote`, bukan `address`. Kolom `sales.send_note` yang dicetak struk
   sebagai "CATATAN KIRIM"; alamat customer tidak pernah masuk ke kertas, jadi
   field "Alamat Kirim" yang lama hanya menghasilkan data yang tidak terlihat
   di mana pun — dan membiarkan kasir mengira mengeditnya berarti sesuatu.

   `note` per baris ikut dibawa karena struk mencetaknya sebagai catatan item
   ("saos bnyakin", "tanpa lombok") dan KOT membacanya untuk dapur. Sebelumnya
   keduanya hilang begitu Cetak Ulang ditekan, walau struk aslinya memuatnya.
   -------------------------------------------------------------------------- */

/* `id` dibuat wajib di sini (walau di `SaleLine` opsional) karena baris form
   selalu dibangun lewat `formDariStruk`, dan hanya baris form yang dikirim ke
   `ubahStruk`. `id: 0` berarti baris tanpa primary key — lihat `formDariStruk`. */
type BarisForm = { id: number; name: string; variant: string; qty: number; price: number; note: string };
type FormUbah = { customer: string; sendNote: string; lines: BarisForm[] };

const FORM_KOSONG: FormUbah = { customer: "", sendNote: "", lines: [] };

function formDariStruk(sale: Sale): FormUbah {
  return {
    customer: sale.customer,
    sendNote: sale.sendNote ?? "",
    lines: (sale.lines ?? []).map((l) => ({
      /* `?? 0` menandai baris yang tidak punya id. `ubahStruk` menolak
         angka itu daripada menulis ke `id=eq.0`. */
      id: l.id ?? 0,
      name: l.name,
      variant: l.variant,
      qty: l.qty,
      price: l.price,
      note: l.note ?? "",
    })),
  };
}

function useFormUbah() {
  return useState<FormUbah>(FORM_KOSONG);
}

/** Baris yang akan hilang kalau disimpan dalam keadaan sekarang: qty-nya 0
 *  atau minus. Nama barisnya dipakai untuk peringatan sebelum disimpan —
 *  konfirmasi tanpa nama tidak membuat orang berhenti sebelum menekan Simpan. */
function barisDibuang(lines: BarisForm[]): BarisForm[] {
  return lines.filter((l) => l.qty <= 0);
}

export function StrukDrawer({
  sale,
  onClose,
  onHapus,
  onRestore,
  onHapusPermanen,
  onSimpan,
  sedangProses = false,
}: {
  sale: Sale | null;
  onClose: () => void;
  /** Void struk. Kosong = aksi disembunyikan (dipakai struk contoh). */
  onHapus?: (sale: Sale) => void;
  onRestore?: (sale: Sale) => void;
  /** Hapus permanen. Kosong = aksi disembunyikan. Pemanggilnya yang membuka
   *  konfirmasi — drawer ini tidak menulis apa pun sendiri. */
  onHapusPermanen?: (sale: Sale) => void;
  /** Tulis form Ubah Data ke server. Kosong = tombol Simpan disembunyikan,
   *  karena tanpa ini "✓ Tersimpan" cuma bohong: tidak ada yang masuk
   *  database dan seluruh ketikan hilang saat drawer ditutup. */
  onSimpan?: (payload: UbahStrukInput) => Promise<HasilUbah>;
  /** True selama request ke server berjalan — tombol dinonaktifkan supaya
   *  dua klik cepat tidak mengirim dua permintaan. */
  sedangProses?: boolean;
}) {
  const [mode, setMode] = useState<"lihat" | "edit" | "cetak">("lihat");
  const [tersimpan, setTersimpan] = useState(false);
  const [galatSimpan, setGalatSimpan] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  /* Preview receipt lives in mode "cetak". Ref needed so "Cetak Ulang" can
     call its own print() — the button used to just setMode("cetak"), which
     was a no-op while already in that mode. */
  const strukRef = useRef<StrukHandle>(null);
  /* Cetak ulang harus memakai setelan yang benar-benar aktif, bukan
     STRUK_DEFAULT. Kalau kasir menyetel 80mm, struk yang dicetak ulang akan
     tetap 48mm dan keluar terpotong. */
  const [setelan] = useSetelan();
  const [form, setForm] = useFormUbah();

  /* Buka dengan isi struk yang dipilih. Dilakukan di sini supaya panel
     selalu mulai dari data yang benar, tidak dari sisa edit sebelumnya. */
  const key = sale?.receiptNo ?? "";
  const [lastKey, setLastKey] = useState("");
  if (sale && key !== lastKey) {
    setLastKey(key);
    setMode("lihat");
    setTersimpan(false);
    setGalatSimpan(null);
    setForm(formDariStruk(sale));
  }

  const subtotal = form.lines.reduce((a, l) => a + l.price * l.qty, 0);
  const ongkir = sale?.ongkir ?? 0;
  const diskon = sale?.diskon ?? 0;
  const totalBaru = Math.max(0, subtotal - diskon + ongkir);
  const totalLama = sale?.total ?? 0;

  const ubahBaris = (i: number, patch: Partial<{ qty: number; price: number; note: string }>) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));

  /* Menulis ke server. Gagal = tetap di mode edit dan alasannya ditampilkan;
     keluar dari mode edit padahal tidak ada yang tersimpan adalah cara paling
     cepatittekan kasir mengira perubahannya sudah masuk. */
  const simpan = async () => {
    if (!sale || !onSimpan || menyimpan) return;
    setGalatSimpan(null);
    setMenyimpan(true);
    try {
      const hasil = await onSimpan({
        saleId: sale.id,
        customer: form.customer,
        sendNote: form.sendNote,
        ongkir,
        diskon,
        lines: form.lines.map((l) => ({
          id: l.id,
          qty: l.qty,
          price: l.price,
          note: l.note,
        })),
      });
      if (!hasil.ok) {
        setGalatSimpan(hasil.pesan ?? "Gagal menyimpan perubahan.");
        return;
      }
      /* Total naik = `paid_amount` jadi lebih kecil dari total, jadi struk
         berbalik jadi "Belum Lunas". Diberi tahu di sini, bukan dibiarkan
         muncul sendiri di tabel tanpa penjelasan. */
      if (hasil.statusBerubah) {
        setGalatSimpan(
          `Tersimpan, tapi struk jadi BELUM LUNAS: total naik dari Rp ${totalLama.toLocaleString("id-ID")} ke Rp ${(hasil.total ?? totalBaru).toLocaleString("id-ID")}, sedangkan uang yang sudah dibayar tidak berubah.`,
        );
      } else {
        setGalatSimpan(null);
      }
      setTersimpan(true);
      setTimeout(() => {
        setTersimpan(false);
        setMode("lihat");
      }, 620);
    } catch (e) {
      setGalatSimpan(`Gagal menyimpan: ${(e as Error).message}`);
    } finally {
      setMenyimpan(false);
    }
  };


  return (
    <Drawer
        open={sale !== null}
        onClose={onClose}
        title="Detail Struk"
        subtitle={sale ? `${sale.receiptNo} · ${setelan.receiptWidth}mm` : undefined}
        width="sm:max-w-[480px]"
        footer={
          sale && (
            <AnimatePresence mode="wait" initial={false}>
              {mode === "lihat" && (
                <motion.div
                  key="lihat"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.14 }}
                  className="flex items-center gap-2"
                >
                  {/* Aksi void/restore ada di drawer, bukan cuma di baris
                      tabel. Drawer adalah tempat kasir berada saat sedang
                      mengecek satu struk — jadi tombol "Void" harus
                      terjangkau tanpa menutup panel dulu. Meletakkan aksi
                      ini hanya di baris tabel memaksa menutup drawer, buka
                      lagi, lalu klik baris yang benar. */}
                  {sale.status === "terhapus" ? (
                    /* Struk terhapus punya dua jalan keluar: dikembalikan, atau dihapus
                       permanen. Keduanya icon-only supaya kaki drawer tetap
                       muat untuk "Ubah Data" + "Cetak Ulang". Restore tidak
                       perlu konfirmasi (dapat dibalikin); hapus permanen
                       membuka konfirmasi di halaman, bukan langsung menulis. */
                    <div className="flex items-center gap-2">
                      <IkonAksi
                        label={"Kembalikan struk " + sale.receiptNo + " ke tab Aktif"}
                        title="Kembalikan ke Aktif"
                        ukuran="md"
                        onClick={() => onRestore?.(sale)}
                        disabled={!onRestore || sedangProses}
                      >
                        <IkonRestore />
                      </IkonAksi>
                      <IkonAksi
                        label={"Hapus permanen struk " + sale.receiptNo}
                        title="Hapus permanen — tidak bisa dikembalikan"
                        nada="hapus"
                        ukuran="md"
                        onClick={() => onHapusPermanen?.(sale)}
                        disabled={!onHapusPermanen || sedangProses}
                      >
                        <IkonHapusPermanen />
                      </IkonAksi>
                    </div>
                  ) : (
                    /* Ikon aja, bukan tulisan "Void". Kata "void" bahasa
                       kasir dan tidak selalu berarti batal: struk yang
                       dibatalkan struknya masih ada di tab Terhapus dan bisa
                       dikembalikan. Ikon tong sampah langsung
                       menyampaikan "buang dari daftar aktif" tanpa perlu
                       diterjemahkan dulu, dan tetap punya aria-label plus
                       title supaya maknanya tidak hilang untuk pembaca
                       layar. */
                    <button
                      onClick={() => onHapus?.(sale)}
                      disabled={!onHapus || sedangProses}
                      aria-label={`Hapus struk ${sale.receiptNo}`}
                      title={`Hapus struk ${sale.receiptNo} — bisa dikembalikan dari tab Terhapus`}
                      className={
                        "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border " +
                        "text-muted-foreground transition-colors hover:border-destructive hover:text-destructive " +
                        "disabled:opacity-40"
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.75}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-[18px] w-[18px]"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => setMode("edit")}
                    className={btnGhost + " flex-1"}
                  >
                    Ubah Data
                  </button>
                  <button onClick={() => setMode("cetak")} className={btnPrimary + " flex-1"}>
                    Cetak Ulang
                  </button>
                </motion.div>
              )}

              {mode === "edit" && (
                <motion.div
                  key="edit"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.14 }}
                  className="flex items-center gap-2"
                >
                  {tersimpan && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-bold text-primary-foreground"
                    >
                      ✓ Tersimpan
                    </motion.span>
                  )}
                  <button
                    onClick={() => {
                      setGalatSimpan(null);
                      setMode("lihat");
                    }}
                    disabled={tersimpan || menyimpan}
                    className={btnGhost + " disabled:opacity-40"}
                  >
                    Kembali
                  </button>
                  {/* Rendered only when there is a writer. A permanently disabled "Simpan"
                    is worse than no button: it looks like the action exists,
                    and clicking it explains nothing. */}
                  {onSimpan && (
                    <motion.button
                      onClick={() => void simpan()}
                      disabled={tersimpan || menyimpan}
                      whileTap={{ scale: 0.96 }}
                      className={btnPrimary + " disabled:opacity-40"}
                    >
                      {menyimpan ? "Menyimpan…" : "Simpan"}
                    </motion.button>
                  )}
                </motion.div>
              )}

              {mode === "cetak" && (
                <motion.div
                  key="cetak"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.14 }}
                  className="flex gap-2"
                >
                  <button onClick={() => setMode("lihat")} className={btnGhost}>
                    Kembali
                  </button>
                  {/* Gunakan ref struk, bukan mode: `setMode("cetak")` di
                      dalam mode "cetak" itu set state ke nilai yang sama,
                      jadi nol-op dan dialog cetak tidak pernah muncul.
                      PRINTER_DEFAULT.receiptWidth juga bukan sumber
                      kebenaran di sini — setelan bisa 80mm. */}
                  <button
                    onClick={() => void strukRef.current?.cetak()}
                    className={btnPrimary}
                  >
                    Cetak Ulang
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          )
        }
      >
        {sale && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={STATUS_TONE[sale.status]}>{STATUS_LABEL[sale.status]}</Pill>
              <Pill>{sale.payment}</Pill>
              <Pill>{sale.completedAt}</Pill>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {mode === "lihat" && (
                <motion.div
                  key="rincian"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="space-y-4"
                >
                  <section>
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Rincian Item
                    </h3>
                    <ul className="divide-y divide-border rounded-2xl border border-border">
                      {form.lines.map((l, i) => (
                        <li key={i} className="flex items-center gap-3 p-3">
                          <span className="figure w-7 shrink-0 rounded-lg bg-accent py-0.5 text-center text-xs font-bold text-accent-foreground">
                            {l.qty}×
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{l.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {l.variant} · {rupiah(l.price)} / porsi
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold figure">
                            {rupiah(l.price * l.qty)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Pembayaran
                    </h3>
                    <dl className="space-y-1.5 rounded-2xl border border-border p-3 text-sm">
                      <Line label="Subtotal" value={formatRupiah(subtotal)} />
                      {/* Baris "Diskon" disembunyikan kalau isinya cuma
                          ongkir yang menulis ulang dirinya sendiri.

                          Kolom `discount` di tabel sales bukan diskon harga:
                          aplikasi lama menulis ongkir ke sana. `ongkirDari`
                          sudah mengetahuinya dan menghitung ongkir dari
                          `total - subtotal`, jadi menampilkan kedua kolom
                          sekaligus berarti ongkir yang sama muncul dua
                          kali — dan penjumlahannya terlihat salah:
                          45.000 - 15.000 + 15.000 = 45.000 padahal total
                          60.000. Baris diskon baru muncul kalau nilainya
                          memang berbeda dari ongkir, yaitu struk berdiskon
                          asli. */}
                      {diskon !== ongkir && (
                        <Line label="Diskon" value={rupiah(diskon)} />
                      )}
                      <Line label="Ongkir" value={rupiah(ongkir)} />
                      <div className="flex items-center justify-between border-t border-border pt-1.5 text-base font-bold">
                        <dt>Total</dt>
                        <dd className="figure">{rupiah(sale.total)}</dd>
                      </div>
                      <Line label="Dibayar dengan" value={sale.payment} />
                    </dl>
                  </section>

                  <section>
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Pengiriman
                    </h3>
                    <dl className="space-y-1.5 rounded-2xl border border-border p-3 text-sm">
                      <Line label="Customer" value={sale.customer} />
                      <Line label="Alamat" value={sale.address ?? "—"} />
                      <Line label="Kurir" value={sale.courier ?? "Ambil sendiri"} />
                    </dl>
                  </section>
                </motion.div>
              )}

              {mode === "edit" && (
                <motion.div
                  key="edit"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="space-y-3"
                >
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Nama Customer
                    </span>
                    <input
                      value={form.customer}
                      onChange={(e) => setForm({ ...form, customer: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Catatan Kirim
                    </span>
                    <input
                      aria-label="Catatan kirim"
                      value={form.sendNote}
                      onChange={(e) => setForm({ ...form, sendNote: e.target.value })}
                      className={inputClass}
                      placeholder=" Dicetak di struk sebagai CATATAN KIRIM"
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Yang muncul di kertas. Alamat customer sudah tersimpan di
                      data customer dan tidak dicetak di struk.
                    </span>
                  </label>

                  {/* Item bisa salah ketik: qty kelewat atau harga keliru
                      saat input. Membatalkan struk seluruhnya hanya untuk
                      satu angka adalah langkah yang terlalu berat, jadi
                      keduanya bisa dikoreksi di sini. */}
                  <div className="pt-1">
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Rincian Item
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Subtotal{" "}
                        <span className="figure font-bold text-foreground">
                          {formatRupiah(subtotal)}
                        </span>
                      </span>
                    </div>

                    <ul className="space-y-1.5">
                      {form.lines.map((l, i) => (
                        /* Key by id, not name — the same menu can appear twice
                           in one receipt under different variants, and the
                           name is editable, so a name-based key makes React
                           reuse the wrong row's inputs mid-edit. */
                        <li key={l.id} className="rounded-2xl border border-input bg-card p-2.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                              {l.name}
                              {l.variant && l.variant !== "Normal" && (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  {l.variant}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-xs font-semibold figure">
                              {formatRupiah(l.price * l.qty)}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <label className="flex-1">
                              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Qty
                              </span>
                              <input
                                aria-label={`Qty ${l.name}`}
                                type="number"
                                min={0}
                                step="1"
                                value={l.qty}
                                onChange={(e) => ubahBaris(i, { qty: Number(e.target.value) || 0 })}
                                className="h-9 w-full rounded-lg border border-input bg-card px-2 text-right text-sm figure outline-none focus:border-ring"
                              />
                            </label>
                            <label className="flex-[2]">
                              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Harga / porsi
                              </span>
                              <InputRupiah
                                aria-label={`Harga per porsi ${l.name}`}
                                value={l.price}
                                onChange={(n) => ubahBaris(i, { price: n })}
                                className="h-9 px-2"
                              />
                            </label>
                          </div>

                          {/* Catatan per baris: "saos bnyakin", "tanpa lombok".
                              Ini yang dicetak struk dan dibaca dapur lewat KOT.
                              Tidak ada input-nya sebelumnya, jadi catatan yang
                              sudah tersimpan hilang begitu struk di-cetak ulang. */}
                          <label className="mt-1.5 block">
                            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Catatan item
                            </span>
                            <input
                              aria-label={`Catatan item ${l.name}`}
                              value={l.note}
                              onChange={(e) => ubahBaris(i, { note: e.target.value })}
                              className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
                              placeholder="saos bnyakin, tanpa lombok…"
                            />
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {totalBaru !== totalLama && (
                    <p className="rounded-2xl bg-[#F3DBA2] px-3.5 py-2.5 text-xs font-medium text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]">
                      Total berubah {formatRupiah(totalLama)} → {formatRupiah(totalBaru)}.
                      Uang yang sudah dibayar tidak ikut berubah, jadi kalau total
                      naik struk ini akan jadi{" "}
                      <strong>Belum Lunas</strong>.
                    </p>
                  )}
                  {barisDibuang(form.lines).length > 0 && (
                    /* One string, not several nodes: a sentence broken across
                       elements cannot be read by a screen reader as a
                       sentence, and cannot be matched in a test either. */
                    <p className="rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-xs font-medium text-destructive">
                      {`${barisDibuang(form.lines)
                        .map((l) => l.name)
                        .join(", ")} qty 0 — barisnya akan dihapus, catatan yang ikut hilang.`}
                    </p>
                  )}
                  <p className="rounded-2xl bg-muted px-3.5 py-2.5 text-xs text-muted-foreground">
                    Item ber&nbsp;qty 0 otomatis dibuang saat disimpan. Ongkir dan diskon
                    tidak ikut dihitung ulang — ubah dari menu Penjualan.
                  </p>
                  {/* role="alert": tanpa itu, kegagalan simpan hanya terlihat
                      karena mode tidak berubah, dan itu alasan yang sama
                      dengan animasi biasa. */}
                  {galatSimpan && (
                    <p
                      role="alert"
                      className="rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-xs font-medium text-destructive"
                    >
                      {galatSimpan}
                    </p>
                  )}
                </motion.div>
              )}

              {mode === "cetak" && (
                <motion.div
                  key="cetak"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="mx-auto max-w-[320px] rounded-2xl bg-muted/60 p-3"
                >
                  {/* Pratinjau memakai modul struk yang sama dengan hasil
                      cetak, jadi tidak mungkin melenceng dari struk asli. */}
                  <Struk
                    ref={strukRef}
                    data={{
                      receiptNo: sale.receiptNo,
                      payment: sale.payment,
                      customerName: form.customer,
                      chatDate: sale.completedAt,
                      queueNo: null,
                      /* Dari form, bukan string kosong — begitu pula `note`
                         per item di bawah. Keduanya dulu di-hardcode/dibuang,
                         jadi Cetak Ulang mencetak struk yang isinya berbeda
                         dari struk yang aslinya sudah keluar dari printer. */
                      sendNote: form.sendNote,
                      subtotal,
                      shipping: sale.ongkir ?? 0,
                      /* Total ikut mengikuti form: kalau qty/harga diedit, yang
                         dicetak harus angkanya yang baru, bukan total lama. */
                      total: totalBaru,
                      items: form.lines.map((l) => ({
                        name: l.name,
                        variant: l.variant,
                        qty: l.qty,
                        price: l.price,
                        lineTotal: l.price * l.qty,
                        note: l.note,
                      })),
                    }}
                    setelan={setelan}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
    </Drawer>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold figure">{value}</dd>
    </div>
  );
}
