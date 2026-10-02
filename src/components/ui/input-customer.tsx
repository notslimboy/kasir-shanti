import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { rupiah } from "@/lib/format";
import { filterSaranCustomer, type SaranCustomer } from "@/lib/cocok-customer";

/* ==========================================================================
   Saran nama customer di keranjang kasir.

   Berbeda dari `Combobox` (yang untuk kategori): di sini yang tampil di
   daftar adalah NAMA ASLI customer, sementara yang diketik kasir boleh
   berupa alias. "Bhas Sari 38" harus menemukan "Bhaskara sari 38", dan
   yang tersimpan ke struk adalah yang kedua — supaya ongkir, riwayat,
   dan piutang customer itu tidak terbelah jadi dua orang.

   Aturan pencocokannya ada di `lib/cocok-customer.ts`, bukan di
   sini, karena apa yang dikembalikan menentukan apa yang TERSIMPAN ke
   struk. Itu yang harus dibuktikan test, dan test tidak bisa melihat
   apa yang terjadi di dalam sebuah komponen.
   ========================================================================== */

export function InputCustomer({
  value,
  onChange,
  saran,
  placeholder,
  className,
  label = "Nama customer",
}: {
  value: string;
  onChange: (v: string) => void;
  saran: SaranCustomer[];
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [aktif, setAktif] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const daftar = useMemo(() => filterSaranCustomer(saran, value), [saran, value]);
  const tampil = open && daftar.length > 0;

  useEffect(() => {
    if (!open) return;
    /* `pointerdown`, bukan `click`: pada `click`, penangan kita sudah
       berjalan saat elemen lain selesai memproses kliknya, jadi daftar
       sempat menutup dengan sendirinya lalu terbuka lagi — kelihatan
       seperti kedipan. */
    const tutup = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", tutup);
    return () => document.removeEventListener("pointerdown", tutup);
  }, [open]);

  /* Kursor selalu kembali ke atas saat kueri berubah. Tanpa ini, mengetik
     "a" lalu "ab" menyisakan kursor di baris ke-5 dari daftar yang
     tinggal 2 baris — dan Enter menyimpan customer yang salah. */
  useEffect(() => {
    setAktif(0);
  }, [value]);

  useEffect(() => {
    if (!tampil) return;
    const el = root.current?.querySelector<HTMLElement>('[role="option"][data-aktif="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [aktif, tampil]);

  const pilih = (name: string) => {
    onChange(name);
    setAktif(0);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <input
        ref={input}
        value={value}
        role="combobox"
        aria-label={label}
        aria-expanded={tampil}
        aria-controls={tampil ? listId : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
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
          if (!tampil) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAktif((i) => Math.min(daftar.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAktif((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && daftar[aktif]) {
            e.preventDefault();
            pilih(daftar[aktif].name);
          }
        }}
        className={cn(
          "h-10 w-full rounded-xl border bg-card px-3 text-sm outline-none transition-colors",
          tampil ? "border-ring ring-2 ring-ring/25" : "border-input hover:border-ring",
        )}
      />

      {tampil && (
        <div
          id={listId}
          role="listbox"
          aria-label="Saran customer"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 shadow-pop"
        >
          {daftar.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={c.name === value}
              data-aktif={i === aktif}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setAktif(i)}
              onClick={() => pilih(c.name)}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                i === aktif ? "bg-muted" : "",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {c.name}
                </span>
                {c.jejak && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    dikenal sebagai {c.jejak}
                  </span>
                )}
              </span>
              {c.ongkir > 0 && (
                <span className="figure shrink-0 text-xs font-semibold text-muted-foreground">
                  {rupiah(c.ongkir)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}