import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Checkbox — ganti <input type="checkbox"> bawaan browser.

   Yang bawaan browser tidak bisa mengikuti tema: di mode gelap kotak putihnya
   tetap putih, dan di macOS centangnya biru sistem yang bukan warna aplikasi
   ini. Karena itu checkbox-nya dibuat sendiri.

   Yang ditangani di sini:

   1. Tiga keadaan: belum centang, centang, dan "sebagian tercentang".
      Yang tengah dipakai oleh "Pilih semua" — kalau sebagian baris sudah
      dipilih, kotaknya setengah, bukan centang penuh yang berbohong.
   2. Area klik 32px untuk kotak 18px. Tabel piutang punya baris tinggi dan
      checkbox di kolom paling kiri; kalau yang diklik harus persis pada
      kotak 18px, sering meleset jadi membuka baris struk.
   3. Checkbox asli tetap dipakai, disembunyikan `sr-only`. Jadi fokus
      keyboard, tombol Space, dan submit form tetap jalan gratis.
   ========================================================================== */

const KOTAK = { sm: "h-[18px] w-[18px]", md: "h-5 w-5" } as const;
const SAPU = { sm: "h-3 w-3", md: "h-3.5 w-3.5" } as const;

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled = false,
  ukuran = "sm",
  className,
}: {
  checked: boolean;
  /** Tampilkan sebagai "sebagian tercentang". Nilai `checked` tetap yang
   *  menentukan state sebenarnya; ini cuma tampilan. */
  indeterminate?: boolean;
  /** Menerima nilai akhir, bukan event. */
  onChange: (checked: boolean) => void;
  /** Wajib: checkbox tanpa nama tidak berarti apa-apa untuk pembaca layar. */
  label: string;
  disabled?: boolean;
  ukuran?: keyof typeof KOTAK;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  /* `indeterminate` tidak punya atribut HTML, cuma properti DOM — jadi
     harus dipasang lewat ref setiap render. */
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  const sebagian = indeterminate && !checked;

  return (
    <label
      /* Padding + margin negatif: area klik jadi 32px tanpa membuat kotak
         terlihat sebesar itu. */
      className={cn(
        "inline-grid shrink-0 cursor-pointer place-items-center p-1.5 -m-1.5",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative grid place-items-center rounded-[7px] border-2 bg-card transition-colors duration-150",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card",
          KOTAK[ukuran],
          checked || sebagian
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input hover:border-primary/60",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "transition-all duration-150",
            SAPU[ukuran],
            checked ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        {/* Sebagian tercentang: garis, bukan cek. */}
        <span
          className={cn(
            "absolute h-0.5 w-2.5 rounded-full bg-current transition-opacity duration-150",
            sebagian ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </label>
  );
}