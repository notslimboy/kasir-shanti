import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Select — pengganti <select> bawaan browser.

   Kenapa tidak pakai native: popup OS tidak bisa diberi token tema, jadi di
   mode gelap tampil putih dan terpotong di layar kecil. Semua kontrol di app
   ini karena itu dibangun sendiri.

   Perilaku: klik buka, ketik untuk mencari (opsional), panah/Home/End/
   Enter/Escape untuk keyboard, klik di luar untuk menutup.
   ========================================================================== */

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  prefix?: React.ReactNode;
  /* Judul kelompok. Opsi yang bersebelahan dengan group sama dirangkai di
     bawah satu header — setara <optgroup> di select native, tanpapopup OS. */
  group?: string;
};

export function Select({
  value,
  onChange,
  options,
  placeholder = "Pilih…",
  searchable = false,
  searchPlaceholder = "Cari…",
  align = "start",
  className,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  align?: "start" | "end";
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /* Posisi panel dalam koordinat viewport. Panel dirender lewat portal ke
     body: kalau tetap di dalam DOM trigger, ia ikut terpotong oleh
     overflow-x-auto tabel draft — persis yang terjadi di halaman import. */
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || q.trim() === "") return options;
    const k = q.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(k) ||
        (o.hint ?? "").toLowerCase().includes(k),
    );
  }, [options, q, searchable]);

  // tutup saat klik di luar (panel ikut diperiksa karena ada di portal)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !panelRef.current?.contains(t))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /* Hitung ulang posisi tiap kali panel dibuka dan tiap halaman digulir:
     panel ikut mengikuti trigger-nya, tidak pernah menggantung di tempat
     lama. Kalau ruang bawah tidak cukup, panel dibuka ke ATAS. */
  const hitungPosisi = useMemo(
    () => () => {
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const bawah = window.innerHeight - r.bottom - 8;
      const atas = r.top - 8;
      /* Panel dibuka ke bawah kalau ada ruang, kalau tidak ke atas. Tanpa ini
         baris paling bawah tabel tidak punya tempat untuk membuka daftar. */
      const tinggiMaks = Math.max(
        160,
        Math.min(320, bawah >= 200 || bawah >= atas ? bawah : atas),
      );
      const lebar = Math.max(r.width, 224);
      const kiri = align === "end" ? r.right - lebar : r.left;
      setPos({
        left: Math.max(8, Math.min(kiri, window.innerWidth - lebar - 8)),
        width: lebar,
        top:
          bawah >= 200 || bawah >= atas
            ? r.bottom + 6
            : Math.max(8, r.top - tinggiMaks - 6),
        maxHeight: tinggiMaks,
      });
    },
    [align],
  );

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    hitungPosisi();
    const ulang = () => hitungPosisi();
    window.addEventListener("scroll", ulang, true);
    window.addEventListener("resize", ulang);
    return () => {
      window.removeEventListener("scroll", ulang, true);
      window.removeEventListener("resize", ulang);
    };
  }, [open, hitungPosisi]);

  // fokus ke kolom cari begitu panel terbuka
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
    if (!open) setQ("");
  }, [open, searchable]);

  // scroll opsi aktif ke dalam pandangan
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) pick(opt.value);
    }
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-card px-3.5 text-left text-sm transition-colors",
          open
            ? "border-ring ring-2 ring-ring/25"
            : "border-input hover:border-ring",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.prefix}
          <span
            className={cn(
              "truncate",
              selected ? "font-semibold" : "text-muted-foreground",
            )}
          >
            {selected?.label ?? placeholder}
          </span>
          {selected?.hint && (
            <span className="truncate text-xs text-muted-foreground">
              {selected.hint}
            </span>
          )}
        </span>
        <motion.svg
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0 text-muted-foreground"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden
        >
          <path
            d="M5 7.5 10 12.5 15 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>

      {/* Panel lewat portal ke body, di luar AnimatePresence: AnimatePresence
          tidak melacak anak yang sudah diportal, jadi panelnya tidak pernah
          benar-benar muncul. */}
      {open &&
        pos &&
        createPortal(
          <motion.div
            ref={panelRef}
            style={{
              top: pos.top,
              left: pos.left,
              minWidth: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 100,
            }}
            className="fixed overflow-hidden rounded-2xl border border-border bg-popover shadow-pop"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={onKeyDown}
          >
            {searchable && (
              <div className="border-b border-border p-2">
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  placeholder={searchPlaceholder}
                  className="h-9 w-full rounded-lg bg-muted px-3 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            )}

            <div
              ref={listRef}
              id={listId}
              role="listbox"
              className="overflow-y-auto p-1.5"
              style={{ maxHeight: pos.maxHeight - (searchable ? 52 : 12) }}
            >
              {filtered.map((o, i) => {
                const on = o.value === value;
                const judulBaru = o.group && o.group !== filtered[i - 1]?.group;
                return (
                  <div key={o.value}>
                    {judulBaru && (
                      <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                        {o.group}
                      </p>
                    )}
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={on}
                      data-idx={i}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                        i === active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {o.prefix}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          on && "font-semibold text-foreground",
                        )}
                      >
                        {o.label}
                      </span>
                      {o.hint && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {o.hint}
                        </span>
                      )}
                      {on && <span className="shrink-0 text-primary">✓</span>}
                    </button>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Tidak ada yang cocok
                </p>
              )}
            </div>
          </motion.div>,
          document.body,
        )}
    </div>
  );
}
