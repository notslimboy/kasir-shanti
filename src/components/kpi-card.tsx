import { cn } from "@/lib/utils";

/* ==========================================================================
   KPI card — dari design/reference.png
   Varian "active" (kartu pertama) = hijau tua + teks putih.
   Angka: Plus Jakarta Sans tabular, BUKAN font mono.
   ========================================================================== */

export function KpiCard({
  label,
  value,
  sub,
  delta,
  active = false,
  icon,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  active?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div
      className={cn(
        "relative rounded-3xl p-4 shadow-card transition-colors sm:p-5",
        active
          ? "bg-sidebar text-sidebar-foreground"
          : "bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "text-[11px] font-semibold leading-tight tracking-[0.01em] sm:text-[13px] sm:tracking-[0.02em]",
            active ? "text-sidebar-foreground/85" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full sm:h-9 sm:w-9",
              active ? "bg-white/10 text-primary" : "bg-accent text-accent-foreground",
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="mt-2 text-[19px] font-bold leading-none tracking-[-0.02em] figure sm:mt-3 sm:text-[26px] xl:text-[30px]">
        {value}
      </div>

      {(delta !== undefined || sub) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:mt-3 sm:gap-2 sm:text-xs">
          {delta !== undefined && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-semibold figure",
                up
                  ? active
                    ? "bg-primary/20 text-primary"
                    : "bg-success/15 text-success"
                  : "bg-destructive/12 text-destructive",
              )}
            >
              {up ? "+" : ""}
              {/* Desimal hanya ketika itu mengubah arti: "1421.0%" terbaca seperti
                  hasil pengukuran presisi, padahal pembacaannya "1421%". */}
              {Math.abs(delta) >= 10 ? Math.round(delta) : delta.toFixed(1)}%
            </span>
          )}
          {sub && (
            <span className={active ? "text-sidebar-foreground/60" : "text-muted-foreground"}>
              {sub}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
