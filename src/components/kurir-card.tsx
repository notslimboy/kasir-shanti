import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { rupiah, rupiahShort } from "@/lib/format";
import { TAG_TANPA_PEMETAAN, type KurirTotal } from "@/lib/kurir";

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/* Kartu ongkir per kurir.
 *
 * Baris utamanya satu per kurir ("Hide/Vendi", "Yanto", …) karena itu yang
 * ditanyakan. Rincian area (ITS, Sutorejo, …) dibuka saat diklik — tetap di
 * dalam kartu ini, bukan disembunyikan di halaman lain.
 *
 * Karena tabel sales tidak punya kolom kurir, angka ini diturunkan dari tag
 * area di customers. Kartu ini menampilkan tag itu sebagai sumbernya, jadi
 * kalau pemetaannya salah, angka yang salah itu kelihatan penyebabnya.
 */
export function KurirCard({
  kurir,
  total,
  /** Rentang yang dihitung, supaya judul tidak mengarang rentang. */
  rentang,
}: {
  kurir: KurirTotal[];
  total: number;
  rentang: string;
}) {
  const [buka, setBuka] = useState<string | null>(null);
  const terbesar = Math.max(1, ...kurir.map((k) => k.total));

  if (kurir.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <p className="text-sm text-muted-foreground">Tidak ada struk berongkir di rentang ini</p>
      </div>
    );
  }

  /* Kartu ini punya dua mode pemakai dengan tinggi yang berbeda:
     - di Beranda, Card-nya `plain` (tanpa fillBody, tanpa tinggi). Induk
       `flex h-full` lalu resolve ke 0 dan `flex-1` di bawah tidak punya
       tinggi definite untuk di-clip, sehingga progress bar meluber keluar
       kartu.
     - di Penjualan, Card-nya `fillBody className="h-[340px]"`, jadi
       `h-full` benar-benar 340px dan daftar bisa di-scroll.

     `min-h-*` di bawah menutup celah mode pertama: daftar dapat tinggi
     minimal yang masih wajar, jadi `flex-1` selalu punya kotak untuk
     diisi dan `overflow` benar-benar memotong. */
  return (
    <div className="flex h-full min-h-[190px] flex-col">
      <div className="shrink-0 pb-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Total · {rentang}
        </div>
        <div className="mt-0.5 text-xl font-bold tracking-tight figure">{rupiah(total)}</div>
      </div>

      {/* `overflow-x-hidden` wajib, bukan opsional: `overflow-y-auto` saja
         membiarkan isi yang lebih lebar lolos ke samping tanpa terpotong.
         Bar progress dikembalikan persis ke lebar daftar, jadi-ui yang
         gegeben lebih lebar dari card (konten memanjang, tidak meluber).
         `min-w-0` supaya flex child ini boleh menyusut di dalam grid/flex
         yang lebar minimnya nol — tanpa itu, `flex-1` memaksa lebar
         konten minimum dan melenceng keluar. */}
      <ul className="min-h-0 min-w-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-0.5">
        {kurir.map((k, i) => {
          const terbuka = buka === k.kurir;
          return (
            <li key={k.kurir} className="min-w-0">
              {/* `box-border` + `max-w-full` menjaga bar(is) di dalam
                  kotak tombol, bukan menggantung dari tepi kanan. */}
              <button
                onClick={() => setBuka(terbuka ? null : k.kurir)}
                aria-expanded={terbuka}
                className="box-border w-full max-w-full rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-white"
                    style={{ background: CHART[i % CHART.length] }}
                    aria-hidden="true"
                  >
                    {k.kurir === TAG_TANPA_PEMETAAN ? "?" : k.kurir.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{k.kurir}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {k.areas.length > 1 ? `${k.areas.length} area · ` : ""}
                      {k.count} struk
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold figure">{rupiahShort(k.total)}</span>
                  <motion.svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    animate={{ rotate: terbuka ? 180 : 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </motion.svg>
                </div>
                <div className="mt-1 h-1.5 w-full max-w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(k.total / terbesar) * 100}%`, background: CHART[i % CHART.length] }}
                  />
                </div>
              </button>

              <AnimatePresence initial={false}>
                {terbuka && (
                  <motion.ul
                    key="rincian"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    {k.areas.map((a) => (
                      <li
                        key={a.tag}
                        className="flex items-center justify-between gap-3 border-l-2 border-border py-1 pl-3 pr-1.5 text-xs"
                      >
                        <span className="min-w-0 truncate text-muted-foreground">{a.tag}</span>
                        <span className="shrink-0 figure text-muted-foreground">{a.count}×</span>
                        <span className="shrink-0 font-semibold figure">{rupiah(a.total)}</span>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

