import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   DateRangePicker — kalender rentang tanggal, dibuat sendiri.

   <input type="date"> membuka picker milik sistem operasi: tidak bisa diberi
   token tema, gaya berbeda tiap platform, dan tidak bisa pilih rentang dalam
   satu langkah. Di sini semuanya milik app: forest + lime, mode gelap ikut,
   dan bisa pilih dari–sampai dalam satu kalender.
   ========================================================================== */

export type DateRange = { from: Date; to: Date };

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const d = (y: number, m: number, day: number) => new Date(y, m, day);
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (x: Date) => d(x.getFullYear(), x.getMonth(), x.getDate());
const addMonths = (x: Date, n: number) => d(x.getFullYear(), x.getMonth() + n, 1);

export function tanggalPendek(x: Date): string {
  return `${x.getDate()} ${BULAN_SINGKAT[x.getMonth()]} ${x.getFullYear()}`;
}

/** "1 – 30 Sep 2026", atau ringkas kalau bulan sama. */
export function labelRentang(r: DateRange | null): string {
  if (!r) return "Pilih rentang";
  const a = r.from;
  const b = r.to;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} – ${b.getDate()} ${BULAN_SINGKAT[a.getMonth()]} ${a.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} ${BULAN_SINGKAT[a.getMonth()]} – ${b.getDate()} ${BULAN_SINGKAT[b.getMonth()]} ${a.getFullYear()}`;
  }
  return `${tanggalPendek(a)} – ${tanggalPendek(b)}`;
}

export function presetRentang(): { id: string; label: string; range: () => DateRange }[] {
  const now = startOfDay(new Date());
  const back = (n: number) => d(now.getFullYear(), now.getMonth(), now.getDate() - n + 1);
  return [
    { id: "today", label: "Hari ini", range: () => ({ from: now, to: now }) },
    { id: "7", label: "7 hari", range: () => ({ from: back(7), to: now }) },
    { id: "30", label: "30 hari", range: () => ({ from: back(30), to: now }) },
    {
      id: "month",
      label: "Bulan ini",
      range: () => ({ from: d(now.getFullYear(), now.getMonth(), 1), to: now }),
    },
    {
      id: "last",
      label: "Bulan lalu",
      range: () => {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return {
          from: lm,
          to: new Date(lm.getFullYear(), lm.getMonth() + 1, 0),
        };
      },
    },
  ];
}

export function DateRangePicker({
  value,
  onChange,
  onPratinjau,
  className,
  align = "start",
  showPresets = true,
}: {
  value: DateRange | null;
  onChange: (r: DateRange | null) => void;
  /** Rentang sudah pasti TAPI belum diterapkan (klik tanggal kedua, sebelum
   *  "Terapkan" ditekan). Dipakai halaman laporan untuk menarik datanya
   *  lebih dulu, supaya saat diterapkan rentangnya sudah ada — jeda antara
   *  klik kedua dan "Terapkan" itu cukup untuk satu query selesai. */
  onPratinjau?: (r: DateRange) => void;
  className?: string;
  align?: "start" | "end";
  showPresets?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | null>(value);
  /* anchor = tanggal awal yang sedang ditunggu pasangannya. Dipisah dari
     draft karena draft sudah punya `to` sejak klik pertama; kalau_andanya
     dipakai untuk_status_, klik kedua dianggap sebagai rentang baru. */
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [cursor, setCursor] = useState<Date>(() => value?.from ?? new Date());
  const [hover, setHover] = useState<Date | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // mulai dari nilai yang sedang berlaku setiap kali dibuka
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setCursor(value?.from ?? new Date());
    setAnchor(null);
    setHover(null);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = first.getDay(); // 0 = Minggu
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor]);

  /* lo/hi = rentang yang sedang digambar. Selama anchor masih menunggu
     pasangan, ujung yang digeser mengikuti kursor mouse supaya kasir bisa
     lihat dulu panjang rentangnya sebelum melepas klik kedua. */
  const lo = anchor ?? draft?.from ?? null;
  const hi =
    anchor === null
      ? draft?.to ?? null
      : hover === null
        ? anchor
        : hover < anchor
          ? anchor
          : hover;

  const choose = (day: Date) => {
    const day0 = startOfDay(day);
    if (anchor === null) {
      // klik pertama: tentukan tanggal awal, tunggu tanggal akhir
      setAnchor(day0);
      setDraft({ from: day0, to: day0 });
      setHover(null);
      return;
    }
    // klik kedua: tutup rentang. Mundur juga ditoleransi.
    const lengkap = day0 < anchor ? { from: day0, to: anchor } : { from: anchor, to: day0 };
    setDraft(lengkap);
    setAnchor(null);
    setHover(null);
    /* Rentangnya sudah pasti; yang tersisa cuma menekan "Terapkan". Beri
       tahu pemanggil sekarang, bukan nanti, supaya tarikannya berjalan
       selama kasir membaca ringkasan dan menggerakkan tangan. */
    onPratinjau?.(lengkap);
  };

  const moveCursor = (days: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + days);
    setCursor(next); // grid mengikuti cursor, jadi bulan ikut bergeser
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${next.toDateString()}"]`)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (k === "ArrowLeft") {
      e.preventDefault();
      moveCursor(-1);
    } else if (k === "ArrowRight") {
      e.preventDefault();
      moveCursor(1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      moveCursor(-7);
    } else if (k === "ArrowDown") {
      e.preventDefault();
      moveCursor(7);
    } else if (k === "PageUp") {
      e.preventDefault();
      setCursor(addMonths(cursor, -1));
    } else if (k === "PageDown") {
      e.preventDefault();
      setCursor(addMonths(cursor, 1));
    }
  };

  const hariIni = startOfDay(new Date());

  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Pilih rentang tanggal"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-card px-3.5 text-sm font-semibold transition-colors",
          open ? "border-ring ring-2 ring-ring/25" : "border-input hover:border-ring",
        )}
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden>
            <path
              d="M5 6.5h10v9H5zM5 9h10M8 4.5v3M12 4.5v3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {labelRentang(value)}
        </span>
        <motion.svg
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0 text-muted-foreground"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden
        >
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Kalender rentang tanggal"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute z-50 mt-1.5 w-[21.5rem] rounded-2xl border border-border bg-popover p-3 shadow-pop",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            {/* header bulan */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Bulan sebelumnya"
                onClick={() => setCursor(addMonths(cursor, -1))}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                ‹
              </button>
              <div className="text-sm font-bold">
                {BULAN[cursor.getMonth()]} {cursor.getFullYear()}
              </div>
              <button
                type="button"
                aria-label="Bulan berikutnya"
                onClick={() => setCursor(addMonths(cursor, 1))}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                ›
              </button>
            </div>

            {showPresets && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {presetRentang().map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const r = p.range();
                      setDraft(r);
                      setCursor(r.from);
                      setAnchor(null);
                      onChange(r); // preset sudah rentang utuh, langsung dipakai
                    }}
                    className="rounded-full border border-input px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* nama hari */}
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-muted-foreground">
              {HARI.map((h) => (
                <div key={h} className="py-1">
                  {h}
                </div>
              ))}
            </div>

            {/* grid tanggal */}
            <div ref={gridRef} className="mt-0.5 grid grid-cols-7 gap-0.5">
              {cells.map((day) => {
                const day0 = startOfDay(day);
                const outside = day.getMonth() !== cursor.getMonth();
                const isFrom = lo ? sameDay(day0, lo) : false;
                const isTo = hi ? sameDay(day0, hi) : false;
                const inRange = lo && hi && day0 > lo && day0 < hi;
                const today = sameDay(day0, hariIni);

                return (
                  <button
                    key={day0.toDateString()}
                    type="button"
                    data-day={day0.toDateString()}
                    onClick={() => choose(day0)}
                    onMouseEnter={() => setHover(day0)}
                    className={cn(
                      "relative grid h-9 place-items-center text-sm transition-colors",
                      outside && "text-muted-foreground/40",
                      !outside && !inRange && !isFrom && !isTo && "hover:bg-muted",
                      inRange && "bg-accent text-accent-foreground",
                      (isFrom || isTo) && "bg-primary font-bold text-primary-foreground",
                      // tepi rentang dibuat membulat hanya di sisi luar
                      isFrom && !isTo && "rounded-l-xl",
                      isTo && !isFrom && "rounded-r-xl",
                      isFrom && isTo && "rounded-xl",
                    )}
                  >
                    {day.getDate()}
                    {today && !isFrom && !isTo && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-ring" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* ringkasan + aksi */}
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <div className="min-w-0 flex-1 whitespace-nowrap text-xs leading-tight text-muted-foreground">
                <div>
                  Dari <span className="font-semibold text-foreground">{draft ? tanggalPendek(draft.from) : "—"}</span>
                </div>
                <div>
                  Sampai{" "}
                  <span className="font-semibold text-foreground">
                    {anchor !== null ? "pilih tanggal kedua" : draft?.to ? tanggalPendek(draft.to) : "—"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setAnchor(null);
                  setCursor(new Date());
                  onChange(null);
                }}
                className="shrink-0 rounded-full border border-input px-3 h-9 text-xs font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                Reset
              </button>
              <button
                type="button"
                disabled={!draft?.to || anchor !== null}
                onClick={() => {
                  if (draft?.to) onChange(draft);
                  setOpen(false);
                }}
                className={cn(
                  "shrink-0 rounded-full px-4 h-9 text-xs font-bold transition-opacity",
                  draft?.to
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "cursor-not-allowed bg-muted text-muted-foreground opacity-60",
                )}
              >
                Terapkan
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
