import { cn } from "@/lib/utils";

/* ==========================================================================
   Tombol aksi berbentuk icon.

   Dipakai di baris tabel Detail Struk dan di kaki drawer: tempatnya sempit,
   dan teks tombol bertumpuk ("Restore", "Hapus", "Hapus permanen") membuat
   kolom Aksi terlalu lebar untuk tabel yang isinya sudah padat.

   Karena tidak ada teks, dua hal yang wajib ikut ada di setiap tombol:
   aria-label (untuk pembaca layar) dan title (untuk hover), dan keduanya
   harus menyebut nama struk — "Hapus" tanpa nomornya tidak ada artinya saat
   ada beberapa baris.

   Bentuk icon dipilih agar dua aksi ini tidak tertukar saat kursor bergerak
   cepat: restore = panah berputar, hapus permanen = api. Api selalu merah,
   karena satu-satunya aksi di app ini yang tidak bisa dibatalkan.
   ========================================================================== */

const UKURAN = { sm: "h-8 w-8", md: "h-11 w-11" } as const;

export type NadaIkon = "netral" | "hapus";

export function IkonAksi({
  label,
  title,
  onClick,
  disabled = false,
  nada = "netral",
  ukuran = "sm",
  children,
  className,
}: {
  /** Nama aksesibilitas — menyebut struk yang dibentuk. */
  label: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  nada?: NadaIkon;
  ukuran?: keyof typeof UKURAN;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border transition-colors",
        UKURAN[ukuran],
        nada === "hapus"
          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Panah berputar ke kiri: kembalikan ke daftar aktif. */
export function IkonRestore({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

/** Api: hapus permanen, tidak bisa dibalikin. */
export function IkonHapusPermanen({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

/** Sampah: buang satu baris dari daftar kerja (mis. draft import). Berbeda
    dari api di atas — yang ini bagian dari pekerjaan yang belum jadi data,
    jadi tidak perlu alarmed dan tidak menyentuh pembukuan. */
export function IkonHapus({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 11.1A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10.5 11v5M13.5 11v5" />
    </svg>
  );
}