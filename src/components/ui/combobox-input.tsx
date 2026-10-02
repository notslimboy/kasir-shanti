import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Combobox — input teks yang bisa memilih dari daftar, atau mengetik nilai
   yang belum ada di daftar.

   Dipakai untuk kategori: kategori bukan entitas terpisah, jadi user harus
   bisa mengetik "Chinese Food" хотя belum ada produk yang memakainya, dan
   bisa juga memilih kategori lama yang sudah dipakai produk lain.
   ========================================================================== */

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  /** Label baris terakhir saat teks tidak cocok dengan opsi mana pun. */
  createLabel = "Tambah",
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  createLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [aktif, setAktif] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const ketik = value.trim();
  const lower = ketik.toLowerCase();
  const sudahAda = useMemo(
    () => options.some((o) => o.trim().toLowerCase() === lower),
    [options, lower],
  );

  /* Teks yang diketik tidak pernah jadi opsi sendiri kalau sudah ada di
     daftar — kalau tidak, mengetik ulang kategori yang sudah ada menghasilkan
     dua baris untuk nilai yang sama. */
  const saran = useMemo(
    () =>
      ketik === ""
        ? options
        : options.filter((o) => o.toLowerCase().includes(lower) && o.trim().toLowerCase() !== lower),
    [options, ketik, lower],
  );

  const buatBaru = ketik !== "" && !sudahAda;
  const total = saran.length + (buatBaru ? 1 : 0);
  /* Prompt fermeture de la liste quand on choisit une catégorie déjà
     connue: rester ouvert donne l'impression que le choix n'a pas pris. */
  const pilih = (v: string) => {
    onChange(v);
    setAktif(0);
    setOpen(false);
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <input
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setAktif(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        /* Ditunda sedikit supaya klik pada saran (yang menutup daftar) tidak
           lebih dulu membatalkan fokus input. */
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!open || total === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAktif((i) => Math.min(total - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAktif((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const v = buatBaru && aktif === saran.length ? ketik : saran[aktif];
            if (v !== undefined) pilih(v);
          }
        }}
        className={cn(
          "h-11 w-full rounded-xl border bg-card px-3.5 text-sm outline-none transition-colors",
          open ? "border-ring ring-2 ring-ring/25" : "border-input hover:border-ring",
        )}
      />

      {open && total > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 shadow-pop"
        >
          {saran.map((o, i) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={o === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setAktif(i)}
              onClick={() => pilih(o)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                i === aktif ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{o}</span>
              {o === value && <span className="shrink-0 text-primary">✓</span>}
            </button>
          ))}
          {buatBaru && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setAktif(saran.length)}
              onClick={() => pilih(ketik)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                aktif === saran.length ? "bg-muted" : "",
              )}
            >
              <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {createLabel}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{ketik}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}