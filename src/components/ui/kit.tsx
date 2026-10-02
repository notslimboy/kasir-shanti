import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  sub,
  action,
  className,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  /* Lebar mengikuti isinya, bukan `w-full`. Tabs yang dipaksa selebar
     kartu menyisakan ruang kosong setelah tab terakhir, dan ruang kosong
     itu terlihat seperti ada tab yang gagal dirender. Kalau memang mau
     melebar, isi tabnya harus ikut `flex-1` — bukan container-nya. */
  return (
    <div
      role="tablist"
      className={cn("flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1", className)}
    >
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors",
            value === t.id ? "bg-card shadow-card text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 figure opacity-70">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "accent" | "warn" | "danger";
}) {
  const tones = {
    plain: "bg-card",
    accent: "bg-sidebar text-sidebar-foreground",
    warn: "bg-[#F3DBA2] dark:bg-[#3A2A10]",
    danger: "bg-destructive/10",
  }[tone];
  return (
    <div className={cn("rounded-2xl p-3.5 shadow-card sm:p-4", tones)}>
      <div
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          tone === "accent" ? "text-sidebar-foreground/70" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div className="mt-1.5 text-[17px] font-bold tracking-[-0.01em] figure sm:text-xl">{value}</div>
      {hint && (
        <div className={cn("mt-0.5 text-xs", tone === "accent" ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function Bar({ pct, tone = "auto" }: { pct: number; tone?: "auto" | "warn" | "danger" }) {
  const bg = tone === "danger" ? "var(--destructive)" : tone === "warn" ? "var(--warning)" : "var(--chart-3)";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: bg }} />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

export const btnPrimary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90";

export const btnGhost =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-input bg-card px-5 font-semibold text-foreground transition-colors hover:border-ring";
