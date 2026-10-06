import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Card, Pill } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { btnGhost, btnPrimary } from "@/components/ui/kit";
import { STRUK_DEFAULT } from "@/lib/struk";
import {
  buildKitchenOrderTicket,
  formatQtyDapur,
  type KotTicket,
} from "@/lib/kot";

/* ==========================================================================
   KOT Dapur — rekap total per nama menu untuk satu rentang tanggal.

   Bukan daftar orderan. Dapur tidak menerima nama customer, tidak menerima
   nomor struk, dan tidak menerima harga. Yang masuk ke KOT hanya
   "Nasi Goreng 40x" — satu baris per menu, digabung dari semua struk pada
   rentang yang sedang dipilih di laporan.

   Prinsipnya dipindah apa adanya dari app lama (script.js), termasuk
   pengurutan qty terbesar dulu dan bagian CATATAN ITEM terpisah.
   ========================================================================== */

export function KotCard({
  ticket,
  onPrint,
}: {
  ticket: KotTicket;
  onPrint?: () => void;
}) {
  const [pratinjau, setPratinjau] = useState(false);
  const [mencetak, setMencetak] = useState(false);

  const kosong = ticket.itemTotals.length === 0;
  const adaCatatan = ticket.notedItems.length > 0;

  /* itemTotals sudah terurut qty terbesar dulu (lihat lib/kot.ts), jadi
     entri pertama adalah puncak. Bar proporsi diukur terhadap itu, bukan
     terhadap total: "26x" jadi 100%, "4x" jadi 15%. */
  const puncak = ticket.itemTotals[0]?.quantity || 1;

  const cetak = () => {
    setMencetak(true);
    setTimeout(() => {
      setMencetak(false);
      onPrint?.();
    }, 900);
  };

  return (
    <>
      <Card
        fillBody
        /* Tinggi tetap di atas lg: supaya sejajar dengan Menu Terlaris
           dan KurirCard yang juga h tetap. Kalau min-height, daftar KOT
           tumbuh mengikuti isi dan kartu jadi setinggi 1.100px — persis
           yang dikeluhkan.

           Di bawah lg tidak ada lagi kolom untuk disejajarkan, jadi
           min-height yang lebih tinggi (520px) — ruang daftar lebih lega
           dan digulir di dalamnya. Memakai `min-h` + overflow-y-auto
           (bukan `h`) supaya daftar panjang tidak membuat kartu melonjak. */
        className="min-h-[520px] lg:h-[340px] lg:min-h-0"
        title="KOT Dapur"
        action={
          <Pill tone={kosong ? "neutral" : "warning"}>
            {kosong ? "belum ada item" : `${formatQtyDapur(ticket.itemCount)} item`}
          </Pill>
        }
      >
        <div className="flex h-full flex-col gap-2">
          {/* Dua kalimat versi lama jadi dua baris penuh di layar 390px —
              ruang yang lebih mahal daripada satu item menu. Angkanya sudah
              ada di pill header, jadi tidak perlu diulang. */}
          <p className="text-[11px] leading-snug text-muted-foreground lg:text-xs">
            Rekap {ticket.dateLabel} · ikut rentang & filter customer
          </p>

          {/* min-h-0 wajib: tanpa itu, flex anak melar dan tidak pernah
              menggulir. min-w-0 + overflow-x-hidden pasangan yang wajib
              untuk daftar di dalam card fillBody — `overflow-y-auto`
              saja membiarkan baris yang lebih lebar dari card lolos ke
              samping tanpa terpotong. */}
          <ul className="min-h-0 min-w-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-0.5">
            <AnimatePresence initial={false}>
              {ticket.itemTotals.map((it) => (
                <motion.li
                  key={it.name}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  /* `relative` + `overflow-hidden` itu pasangan yang
                     membuat isian proporsi terpotong mengikuti radius chip.
                     Tanpa `relative`, lebar diukur dari kartu; tanpa
                     `overflow-hidden`, sudutnya keluar dari radius dan
                     chip terlihat kotak di atas, bulat di bawah. */
                  className="relative flex items-baseline gap-2 overflow-hidden rounded-xl bg-muted/60 px-3 py-2"
                >
                  {/* Isian proporsi. Baris KOT ini sudah berurutan qty
                      terbesar dulu, tapi urutan saja tidak terasa saat mata
                      memindai cepat — yang terasa adalah panjang. Ruang
                      tengah yang tadinya kosong sekarang dipakai: pada
                      26x isiannya penuh, pada 1x cuma 12% dan sisanya
                      tetap `bg-muted/60` yang lembut itu. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-r-[10px] bg-primary/12"
                    style={{ width: `${Math.max(12, (it.quantity / puncak) * 100)}%` }}
                  />
                  <span className="relative min-w-0 flex-1 truncate text-sm" title={it.name}>
                    {it.name}
                  </span>
                  <span className="relative shrink-0 text-sm font-bold figure">
                    {formatQtyDapur(it.quantity)}x
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
            {kosong && (
              <li className="grid place-items-center rounded-2xl border border-dashed border-input py-10 text-center">
                <p className="text-sm font-semibold text-muted-foreground">
                  Belum ada item pada rentang ini
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ubah rentang tanggal atau bersihkan filter customer
                </p>
              </li>
            )}
          </ul>

          {/* Catatan item sengaja tidak ditampilkan di kartu ini. Yang
              membutuhkan catatan adalah dapur saat kertas dicetak — di layar
              hanya menambah tinggi kartu dan mengambil ruang untuk info yang
              sudah ada di struk. Bagian CATATAN ITEM tetap ada di printout
              (lihat pratinjau di bawah).

              Strip "Total item" yang pernah ada di sini dihapus: angkanya
              persis sama dengan pill di header (`ticket.itemCount`), jadi
              yang hilang cuma satu baris dan satu pengulangan. */}

          <motion.button
            onClick={() => setPratinjau(true)}
            disabled={kosong}
            whileTap={kosong ? undefined : { scale: 0.98 }}
            className={
              "h-10 shrink-0 rounded-full text-sm font-bold transition-opacity " +
              (kosong
                ? "cursor-not-allowed bg-muted text-muted-foreground opacity-60"
                : "bg-primary text-primary-foreground hover:opacity-90")
            }
          >
            {kosong ? "Tidak ada yang dicetak" : "Lihat & cetak KOT"}
          </motion.button>
        </div>
      </Card>

      <Modal
        open={pratinjau}
        onClose={() => setPratinjau(false)}
        title="Pratinjau KOT"
        subtitle={`${ticket.dateLabel} · ${STRUK_DEFAULT.receiptWidth}mm`}
        footer={
          <div className="flex gap-2">
            <button onClick={() => setPratinjau(false)} className={btnGhost}>
              Tutup
            </button>
            <motion.button onClick={cetak} whileTap={{ scale: 0.97 }} className={btnPrimary}>
              Cetak KOT
            </motion.button>
          </div>
        }
      >
        {/* Ukuran pratinjau mengikuti layar.

            Di desktop (lg+) pratinjau sengaja 300px + 11px: itu skala
            kertas 48mm, jadi yang dilihat ≈ yang keluar dari printer —
            perlu untuk memeriksa Tata letak.

            Di mobile/tablet skalanya dibalik: layar lebih kecil, jadi
            11px di layar HP jauh di bawah batas baca. Karena itu di
            bawah lg kertas justru diperbesar (420px + 15px) — bukan
            diperkecil seperti kebalikan pada responsive design biasa.
            Isinya tetap sama,
            cuma lebih besar; panjang ticket yang melebihi tinggi layar
            digulir oleh body Modal (`overflow-y-auto`), bukan dipotong. */}
        <div className="mx-auto w-full max-w-[420px] sm:max-w-[360px] lg:max-w-[300px]">
          {/* KOT tidak pernah memuat harga. Yang dicetak: KOT, tanggal,
              nama menu + qty, catatan item, dan total item. */}
          <div className="rounded-xl bg-white p-5 font-mono text-[15px] leading-snug text-black shadow-pop sm:p-4 sm:text-[13px] lg:p-4 lg:text-[11px] lg:leading-tight">
            <div className="text-center text-[19px] font-bold sm:text-[17px] lg:text-[14px]">
              KOT
            </div>
            <div className="text-center">{ticket.dateLabel}</div>
            <div className="my-2 border-t border-dashed border-black/50 lg:my-1" />
            {ticket.itemTotals.map((it) => (
              <div key={it.name} className="flex justify-between gap-2">
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                <span className="shrink-0 font-bold">{formatQtyDapur(it.quantity)}x</span>
              </div>
            ))}
            {kosong && <div className="text-center">Belum ada item</div>}

            {adaCatatan && (
              <>
                <div className="my-2 border-t border-dashed border-black/50 lg:my-1" />
                <div className="font-bold">CATATAN ITEM</div>
                {ticket.notedItems.map((n) => (
                  <div key={`${n.name}-${n.note}`} className="font-bold">
                    {formatQtyDapur(n.quantity)}x {n.name}: {n.note}
                  </div>
                ))}
              </>
            )}

            <div className="my-2 border-t border-dashed border-black/50 lg:my-1" />
            <div className="flex justify-between font-bold">
              <span>TOTAL ITEM</span>
              <span>{formatQtyDapur(ticket.itemCount)}</span>
            </div>
          </div>

          <AnimatePresence>
            {mencetak && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
              >
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
                  className="inline-block h-3 w-3 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground"
                />
                Mengirim ke printer dapur…
              </motion.div>
            )}
          </AnimatePresence>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            {ticket.itemTotals.length} menu, total {formatQtyDapur(ticket.itemCount)} porsi.
            Tidak ada harga di KOT — dapur tidak butuh nominal.
          </p>
        </div>
      </Modal>
    </>
  );
}

/** Bangun ulang ticket setiap kali struk / rentang berubah. */
export function useKot(sales: { lines: Parameters<typeof buildKitchenOrderTicket>[0][number]["lines"] }[], from: Date, to: Date) {
  return useMemo(() => buildKitchenOrderTicket(sales, from, to), [sales, from, to]);
}
