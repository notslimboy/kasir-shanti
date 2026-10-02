import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Drawer — panel yang meluncur dari kanan.

   Dipakai untuk mengedit customer dan melihat detail struk. Keduanya
   Nullable: panel tidak pernah ada kalau tidak ada yang dipilih, jadi
   "tutup" bukan sekadar disembunyikan, tapi benar-benar dilepas dari DOM.

   Keluar memakai tween singkat, bukan spring: panel yang menutup dengan
   spring terbaca seperti macet, bukan seperti selesai.
   ========================================================================== */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "sm:max-w-[440px]",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // halaman di belakang tidak boleh ikut bergulir
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            aria-label="Tutup panel"
            className="absolute inset-0 bg-black/45"
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className={cn(
              "absolute inset-y-0 right-0 flex w-full flex-col bg-card shadow-pop",
              width,
            )}
          >
            <header className="flex shrink-0 items-start gap-3 border-b border-border p-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold tracking-[-0.01em]">{title}</h2>
                {subtitle && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Tutup"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-input text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>

            {footer && (
              <footer className="shrink-0 border-t border-border p-4">{footer}</footer>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
