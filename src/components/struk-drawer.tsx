import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Drawer } from "@/components/ui/drawer";
import { Struk } from "@/components/struk";
import { Pill } from "@/components/ui/card";
import { btnGhost, btnPrimary, inputClass } from "@/components/ui/kit";
import { IkonAksi, IkonHapusPermanen, IkonRestore } from "@/components/ui/ikon-aksi";
import { rupiah } from "@/lib/format";
import { formatRupiah } from "@/lib/struk";
import { InputRupiah } from "@/components/ui/input-rupiah";
import type { Sale } from "@/lib/sale";
import { STRUK_DEFAULT } from "@/lib/struk";

/* ==========================================================================
   Detail Struk — drawer yang dibuka dari tabel Detail Struk.

   Isinya tiga hal yang selalu ditanyakan: apa saja yang dibeli, uangnya
   bagaimana, dan siapa yang mengantar. Aksi edit/cetak ulang duduk di kaki
   drawer, tidak di dalam daftar, supaya tabelnya tetap ringkas.
   ========================================================================== */

const STATUS_TONE = { lunas: "success", belum: "warning", terhapus: "danger" } as const;
const STATUS_LABEL = { lunas: "Lunas", belum: "Belum Lunas", terhapus: "Dihapus" } as const;

export function StrukDrawer({
  sale,
  onClose,
  onHapus,
  onRestore,
  onHapusPermanen,
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
  /** True selama request ke server berjalan — tombol dinonaktifkan supaya
   *  dua klik cepat tidak mengirim dua permintaan. */
  sedangProses?: boolean;
}) {
  const [mode, setMode] = useState<"lihat" | "edit" | "cetak">("lihat");
  const [tersimpan, setTersimpan] = useState(false);
  const [form, setForm] = useState<{
    customer: string;
    address: string;
    lines: { name: string; variant: string; qty: number; price: number }[];
  }>({ customer: "", address: "", lines: [] });

  /* Buka dengan isi struk yang dipilih. Dilakukan di sini supaya panel
     selalu mulai dari data yang benar, tidak dari sisa edit sebelumnya. */
  const key = sale?.receiptNo ?? "";
  const [lastKey, setLastKey] = useState("");
  if (sale && key !== lastKey) {
    setLastKey(key);
    setMode("lihat");
    setTersimpan(false);
    setForm({
      customer: sale.customer,
      address: sale.address ?? "",
      lines: (sale.lines ?? []).map((l) => ({
        name: l.name,
        variant: l.variant,
        qty: l.qty,
        price: l.price,
      })),
    });
  }

  const subtotal = form.lines.reduce((a, l) => a + l.price * l.qty, 0);
  const ongkir = sale?.ongkir ?? 0;
  const diskon = sale?.diskon ?? 0;

  const ubahBaris = (i: number, patch: Partial<{ qty: number; price: number }>) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));


  return (
    <Drawer
        open={sale !== null}
        onClose={onClose}
        title="Detail Struk"
        subtitle={sale ? `${sale.receiptNo} · ${STRUK_DEFAULT.receiptWidth}mm` : undefined}
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
                    onClick={() => setMode("lihat")}
                    disabled={tersimpan}
                    className={btnGhost + " disabled:opacity-40"}
                  >
                    Kembali
                  </button>
                  <motion.button
                    onClick={() => {
                      // Item qty 0 dibuang: struk dengan baris 0 akan
                      // tercetak sia-sia.
                      setForm((f) => ({
                        ...f,
                        lines: f.lines.filter((l) => l.qty > 0),
                      }));
                      setTersimpan(true);
                      setTimeout(() => {
                        setTersimpan(false);
                        setMode("lihat");
                      }, 620);
                    }}
                    disabled={tersimpan}
                    whileTap={{ scale: 0.96 }}
                    className={btnPrimary + " disabled:opacity-40"}
                  >
                    Simpan
                  </motion.button>
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
                  <button onClick={() => setMode("cetak")} className={btnPrimary}>
                    Cetak {STRUK_DEFAULT.receiptWidth}mm
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
                      Alamat Kirim
                    </span>
                    <input
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className={inputClass}
                    />
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
                        <li key={`${l.name}-${i}`} className="rounded-2xl border border-input bg-card p-2.5">
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
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="rounded-2xl bg-muted px-3.5 py-2.5 text-xs text-muted-foreground">
                    Item ber&nbsp;qty 0 otomatis dibuang saat disimpan. Ongkir dan diskon
                    tidak ikut dihitung ulang — ubah dari menu Penjualan.
                  </p>
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
                    data={{
                      receiptNo: sale.receiptNo,
                      payment: sale.payment,
                      customerName: form.customer,
                      chatDate: sale.completedAt,
                      queueNo: null,
                      sendNote: "",
                      subtotal,
                      shipping: sale.ongkir ?? 0,
                      total: sale.total,
                      items: form.lines.map((l) => ({
                        name: l.name,
                        variant: l.variant,
                        qty: l.qty,
                        price: l.price,
                        lineTotal: l.price * l.qty,
                      })),
                    }}
                    setelan={STRUK_DEFAULT}
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
