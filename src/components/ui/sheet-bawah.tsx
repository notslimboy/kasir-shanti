import { Drawer as Ui } from "@base-ui/react/drawer";
import { cn } from "@/lib/utils";

/* ==========================================================================
   SheetBawah — bottom sheet untuk mobile/tablet, diadaptasi dari Drawer
   resmi shadcn (Base UI): https://ui.shadcn.com/docs/components/base/drawer

   Menggantikan sheet manual di itsfood.tsx; logic yang dahulu salah kini
   dikerjakan engine, bukan tangan:
   - swipe ke bawah benar-benar menutup: panel mengikuti jari, lepas cepat
     = tertutup (dulu handle-nya cuma hiasan);
   - backdrop menipis mengikuti besar gerakan swipe;
   - scroll halaman dikunci oleh engine (tidak lagi position:fixed +
     scrollTo manual yang rawan bocor di iOS);
   - klik luar / Escape menutup; animasi exit diputar oleh engine
     (AnimatePresence musim lama tidak dibutuhkan lagi);
   - portal.

   Tinggi panel menurut isi (aturan dokumen shadcn: area yang menggulir
   adalah flex item, jangan h-full). CSS var stack tetap dideklarasikan
   karena formula --translate-y memakainya; Base UI mengisi nilainya.
   ========================================================================== */

export function SheetBawah({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxH = "88dvh",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Batas tinggi panel (konten panjang menggulir di dalamnya). */
  maxH?: string;
}) {
  return (
    <Ui.Root
      open={open}
      onOpenChange={(nb) => {
        if (!nb) onClose();
      }}
      swipeDirection="down"
    >
      <Ui.Portal>
        <Ui.Backdrop
          className="fixed inset-0 z-50 min-h-dvh bg-black/45 opacity-[max(var(--drawer-overlay-min-opacity,0),calc(1-var(--drawer-swipe-progress)))] transition-opacity duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] select-none data-ending-style:pointer-events-none data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute"
        />
        <Ui.Viewport className="pointer-events-none fixed inset-0 z-50 select-none data-[modal=true]:pointer-events-auto">
          <Ui.Popup
            style={{ "--drawer-content-max-height": maxH } as React.CSSProperties}
            className={cn(
              /* Base — sama dengan DrawerContent shadcn (punya arah vertikal
                 saja: variasi swipe-axis=x tidak dipakai di sini). */
              "group/drawer-popup pointer-events-auto fixed z-50 m-(--drawer-inset,0px) flex h-(--drawer-content-height) max-h-(--drawer-content-max-height,none) min-h-0 w-(--drawer-content-width,auto) transform-[translate3d(var(--translate-x,0px),var(--translate-y,0px),0)_scale(var(--stack-scale))] flex-col transition-[transform,height,opacity,filter] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform outline-none select-none [interpolate-size:allow-keywords]",
              "data-nested-drawer-open:overflow-hidden data-nested-drawer-open:brightness-95",
              /* Bleed — mengisi celah saat panel tergeser; sisi strip ditentukan
                 data-swipe-direction milik engine (bawah saat swipe down). */
              "after:pointer-events-none after:absolute after:bg-(--drawer-bleed-background,var(--color-popover)) data-[swipe-axis=x]:after:inset-y-0 data-[swipe-axis=x]:after:w-(--bleed) data-[swipe-axis=y]:after:inset-x-0 data-[swipe-axis=y]:after:h-(--bleed) data-[swipe-direction=down]:after:top-full data-[swipe-direction=left]:after:right-full data-[swipe-direction=right]:after:left-full data-[swipe-direction=up]:after:bottom-full",
              /* Ukuran: isi menentukan tinggi, terkurung maxH. */
              "[--drawer-content-height:var(--drawer-height,auto)] data-snap-points:[--drawer-content-height:100dvh]",
              /* Var stack untuk formula swipe (sheet ini tidak nested,
                 tapi variabelnya harus ada supaya calc tidak jadi invalid). */
              "[--bleed:3rem] [--peek:1rem] [--stack-height:var(--drawer-frontmost-height,var(--drawer-height,0px))] [--stack-peek-offset:max(0px,calc((var(--nested-drawers)-var(--stack-progress))*var(--peek)))] [--stack-progress:clamp(0,var(--drawer-swipe-progress),1)] [--stack-scale-base:max(0,calc(1-(var(--nested-drawers)*var(--stack-step))))] [--stack-scale:clamp(0,calc(var(--stack-scale-base)+(var(--stack-step)*var(--stack-progress))),1)] [--stack-shrink:calc(1-var(--stack-scale))] [--stack-step:0.05]",
              /* Transisi buka/tutup + ikut jarinya saat swipe. */
              "data-ending-style:transform-(--closed-transform) data-ending-style:opacity-[0.9999] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-nested-drawer-swiping:duration-0 data-ending-style:data-nested-drawer-swiping:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:transform-(--closed-transform) data-swiping:duration-0 data-ending-style:data-swiping:duration-[calc(var(--drawer-swipe-strength)*400ms)]",
              /* Posisi bawah + formula gerak. */
              "inset-x-0 bottom-0 origin-bottom [--closed-transform:translate3d(0,calc(100%+var(--drawer-inset,0px)+2px),0)] [--translate-y:calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y)-var(--stack-peek-offset)-(var(--stack-shrink)*var(--stack-height)))]",
              /* Bentuk repo. */
              "rounded-t-3xl bg-card shadow-pop",
            )}
          >
            {/* Handle: tanda visual "ini sheet"; drag sesungguhnya terjadi di
                permukaan popup, dideteksi engine Base UI. */}
            <div
              aria-hidden="true"
              className="flex shrink-0 cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing"
            >
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <Ui.Content className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain rounded-[inherit] transition-opacity duration-300 ease-[cubic-bezier(0.45,1.005,0,1.005)] select-text">
              <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 pb-3">
                <div className="min-w-0 flex-1">
                  <Ui.Title className="truncate text-base font-bold tracking-[-0.01em]">
                    {title}
                  </Ui.Title>
                  {subtitle && (
                    <Ui.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                      {subtitle}
                    </Ui.Description>
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
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-3">
                {children}
              </div>
              {footer && (
                <footer className="shrink-0 border-t border-border p-4">{footer}</footer>
              )}
            </Ui.Content>
          </Ui.Popup>
        </Ui.Viewport>
      </Ui.Portal>
    </Ui.Root>
  );
}
