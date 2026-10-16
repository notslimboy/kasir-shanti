import { cn } from "@/lib/utils";

export function Card({
  title,
  action,
  className,
  children,
  bodyClassName,
  fillBody = false,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  /** Isi kartu ikut merebut tinggi sisa (mis. chart yang mengisi card). */
  fillBody?: boolean;
}) {
  return (
    <section
      className={cn("rounded-3xl bg-card p-5 shadow-card", fillBody && "flex flex-col", className)}
    >
      {/* `flex-wrap` + `min-w-0` pada judul: tanpa itu, action selebar
          Tabs/segmen (Aktif · Terhapus) memaksa judul terpotong di layar
          sempit. Dengan wrap, action turun ke baris sendiri dan
          selebar penuh — jauh lebih terbaca daripada judul separuh. */}
      {(title || action) && (
        <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {title && (
            <h2 className="min-w-0 text-base font-semibold tracking-[-0.01em]">{title}</h2>
          )}
          {action}
        </header>
      )}
      <div
        className={cn(
          fillBody && "relative min-h-0 flex-1",
          /* `relative` di mode fill: ChartBox fill memosisikan dirinya
             absolute inset-0 relatif terhadap kotak ini, bukan terhadap
             halaman. Tanpa ini chart akan search sampai ke ancestor
             ber-position dan melompat keluar card.
             `overflow-hidden` menjaga isi (chart, tabel lebar, daftar yang
             melebar) tetap di dalam radius kartu, bukan sekadar meluber
             dan menimpa kartu tetangga. */
          fillBody && "overflow-hidden",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Judul kartu.

    Elemen heading-nya milik `Card` (pembungkus `<h2>`), jadi di sini cukup
    `<span>`: `<h2>` di dalam `<h2>` membuat satu judul dibaca dua kali oleh
    pembaca layar. `className` untuk menyesuaikan ukuran huruf per layar —
    judul yang harus sebasis dengan tombol di sebelahnya tidak boleh pecah
    jadi dua baris hanya karena ukuran huruf desktop. */
export function CardTitle({
  children,
  hint,
  className,
}: {
  children: React.ReactNode;
  hint?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span>{children}</span>
      {hint && (
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          ?
        </span>
      )}
    </span>
  );
}

/** Label status pendek. `whitespace-nowrap` wajib: di baris yang sempit label
    dua kata ("Belum Lunas") pecah jadi dua baris di dalam pill, tingginya
    melebihi tetangganya, dan deretan pill jadi bergerigi. Kalau ruangnya
    habis, yang boleh pindah baris adalah SELURUH pill — induknya yang
    `flex-wrap` — bukan tulisannya. */
export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-[#ECF3F1] text-[#1F5C4A] dark:bg-[#16302A] dark:text-[#7FD6B4]",
    warning: "bg-[#F3DBA2] text-[#8A5A12] dark:bg-[#3A2A10] dark:text-[#F0C987]",
    danger: "bg-destructive/12 text-destructive",
  }[tone];
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", tones, className)}>
      {children}
    </span>
  );
}

export function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  /** Dipisah dari label supaya judul tooltip bisa menjelaskan alasan
      tombol mati tanpa mengubah nama aksesibilitasnya. */
  title,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground",
        // Tombol mati tetap bisa dibaca, bukan hanya bayang-bayang.
        disabled && "cursor-not-allowed opacity-50 hover:border-border hover:text-muted-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
