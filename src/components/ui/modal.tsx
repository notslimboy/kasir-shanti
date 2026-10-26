import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Modal — kotak tengah untuk pratinjau cetak (KOT / struk).
   Berbeda dari Drawer: Drawer untuk mengedit, Modal untuk melihat.
   ========================================================================== */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "sm:max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    /* Kunci scroll: `overflow:hidden` saja bocor — iOS Safari tetap
       menggulir body di baliknya, dan panel belakang ikut lompat posisi.
       Teknik position:fixed + offset scroll membumikan halaman di tempat
       dan mengembalikannya persis saat modal ditutup. */
    const y = window.scrollY;
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.left = prev.left;
      document.body.style.right = prev.right;
      document.body.style.width = prev.width;
      document.body.style.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            aria-label="Tutup"
            className="absolute inset-0 bg-black/45"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className={cn(
              "relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-3xl bg-card shadow-pop",
              size,
            )}
          >
            <header className="flex shrink-0 items-start gap-3 border-b border-border p-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold tracking-[-0.01em]">{title}</h2>
                {subtitle && <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>}
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

            {footer && <footer className="shrink-0 border-t border-border p-4">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
