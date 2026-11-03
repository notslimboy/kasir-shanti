import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

type SidebarContextValue = {
  collapsed: boolean;
  toggleCollapsed: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): Pick<SidebarContextValue, "collapsed" | "toggleCollapsed"> {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar harus dipakai di dalam Sidebar");
  return { collapsed: ctx.collapsed, toggleCollapsed: ctx.toggleCollapsed };
}

/* ========================================================================
   Sidebar — panel forest con indicador lima y navegación adaptable.
   Mobile: Drawer, bukan bottom bar.
   ======================================================================== */

/* `desktopOnly`: Import Pesanan hanya muncul di desktop (lg ke atas).
   Impor CSV butuh keyboard/trackpad dan tabel 9 kolom yang melebar —
   di tablet dan phone form-nya bukan tempat yang masuk akal. Di bawah lg
   item ini disembunyikan (tidak dihapus) supaya route-nya tetap bisa
   dibuka langsung dari URL desktop. */
type IkonNama =
  | "grid"
  | "import"
  | "cart"
  | "box"
  | "receipt"
  | "users"
  | "wallet"
  | "chart"
  | "truck"
  | "banknote"
  | "cog";

type NavItem = {
  id: string;
  /** Visible and accessible label — harus unik antar item, dipakai E2E. */
  label: string;
  /** Tooltip pendek; konteks seksi (ITS Food) sudah mengikat. */
  tip?: string;
  icon: IkonNama;
  desktopOnly?: boolean;
};

const NAV: readonly NavItem[] = [
  { id: "impor", label: "Import Pesanan", icon: "import", desktopOnly: true },
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "kasir", label: "Kasir", icon: "cart" },
  { id: "menu", label: "Menu", icon: "box" },
  { id: "struk", label: "Struk", icon: "receipt" },
  { id: "customer", label: "Customer", icon: "users" },
  { id: "piutang", label: "Piutang", icon: "wallet" },
  /* Seksi ITS Food — tiga menu tetap tampil di mobile untuk cek pesanan. */
  { id: "itsfood-dash", label: "Dasbor", tip: "Dasbor", icon: "chart" },
  { id: "itsfood-orders", label: "Order", tip: "Order", icon: "truck" },
  { id: "itsfood-pay", label: "Payment", tip: "Payment", icon: "banknote" },
  { id: "itsfood-produk", label: "Produk", tip: "Produk", icon: "box" },
  { id: "pengaturan", label: "Pengaturan", icon: "cog" },
] as const;

function Icon({ name }: { name: IkonNama }) {
  const path = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    import: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
    cart: "M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20.5 8H6M9.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    box: "M12 3 3 7.5v9L12 21l9-4.5v-9L12 3ZM3 7.5 12 12l9-4.5M12 12v9",
    receipt: "M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5L6 21V3ZM9 8h6M9 12h6",
    users: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0M16 11a3 3 0 1 0 0-6M15 15.5a5 5 0 0 1 6 4.5",
    wallet: "M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 3-3h10M17 13h.01",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    truck: "M3 7h11v9H3zM14 11h3.6l2.9 3v2H14zM7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
    banknote: "M3 6h18v12H3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 9h.01M18 15h.01",
    cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.15-1.5l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14.5 2h-4l-.35 2.5A8 8 0 0 0 7.55 6L5.1 5 3.1 8.4l2 1.6a8 8 0 0 0 0 3l-2 1.6L5.1 18l2.45-1a8 8 0 0 0 2.6 1.5L10.5 22h4l.35-2.5a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6a8 8 0 0 0 0-3Z",
  }[name];

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function UtilityIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function SidebarHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex shrink-0 items-center gap-2", className)}>{children}</div>;
}

export function SidebarNav({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <nav
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain",
        className,
      )}
      aria-label="Navigasi utama"
    >
      {children}
    </nav>
  );
}

export function SidebarItem({
  icon,
  active = false,
  label,
  children,
  onClick,
  title,
  desktopOnly = false,
  className,
}: {
  icon: IkonNama;
  active?: boolean;
  label?: string;
  children?: ReactNode;
  onClick?: () => void;
  title?: string;
  desktopOnly?: boolean;
  className?: string;
}) {
  const { collapsed } = useSidebar();
  const itemLabel = label ?? children;
  const accessibleLabel = typeof itemLabel === "string" ? itemLabel : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      aria-current={active ? "page" : undefined}
      title={title ?? accessibleLabel}
      className={cn(
        "group relative flex shrink-0 items-center rounded-[12px] transition-[background,color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        collapsed ? "h-[46px] w-[46px] justify-center gap-0 px-0" : "h-10 w-full justify-start gap-3 px-3 text-left",
        desktopOnly && "hidden lg:flex",
        active
          ? "bg-gradient-to-br from-white/[0.14] to-white/[0.055] text-[var(--sidebar-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_5px_16px_-10px_rgba(0,0,0,0.7)]"
          : "text-[var(--sidebar-foreground)]/75 hover:bg-white/[0.07] hover:text-[var(--sidebar-foreground)] active:scale-[0.98]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--lime-bar)] shadow-[0_0_12px_rgba(120,162,43,0.55)] transition-[opacity,transform] duration-300 ease-out",
          active ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0",
        )}
      />
      <span className="shrink-0 transition-transform duration-200 group-hover:scale-110 group-active:scale-95">
        <Icon name={icon} />
      </span>
      {!collapsed && <span className="truncate text-[12px] font-semibold leading-none">{itemLabel}</span>}
    </button>
  );
}

export function SidebarFooter({ children, className }: { children?: ReactNode; className?: string }) {
  return children ? <div className={cn("mt-auto shrink-0", className)}>{children}</div> : null;
}

export function SidebarToggle({ className }: { className?: string }) {
  const { collapsed, toggleCollapsed } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-label={collapsed ? "Perlebar" : "Ciutkan"}
      aria-expanded={!collapsed}
      title={collapsed ? "Perlebar" : "Ciutkan"}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-[background,color,transform] duration-200 hover:bg-white/[0.07] hover:text-sidebar-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        {collapsed ? <path d="m10 6 6 6-6 6" /> : <path d="m14 6-6 6 6 6" />}
      </svg>
    </button>
  );
}

function SidebarContents({
  active,
  onSelect,
  dark,
  setDark,
  hideToggle,
  className,
}: {
  active: string;
  onSelect?: (id: string) => void;
  dark: boolean;
  setDark: (dark: boolean) => void;
  hideToggle?: boolean;
  className?: string;
}) {
  const { collapsed, toggleCollapsed } = useSidebar();
  const { keluar } = useAuth();
  const navId = useId();
  const [signingOut, setSigningOut] = useState(false);

  const renderItem = (item: NavItem) => (
    <SidebarItem
      key={item.id}
      icon={item.icon}
      active={item.id === active}
      label={item.label}
      title={item.tip ?? item.label}
      desktopOnly={item.desktopOnly}
      onClick={() => onSelect?.(item.id)}
    />
  );

  return (
    <aside
      className={cn(
        "relative flex max-h-full shrink-0 flex-col rounded-r-[28px] bg-sidebar pt-5 pb-4 shadow-[8px_0_28px_-18px_rgba(15,35,20,0.5)] transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[88px] items-center" : "w-[228px] items-stretch",
        className,
      )}
      aria-label="Navigasi utama"
      aria-describedby={navId}
    >
      {/*
        Sidebar wrapper in App.tsx holds `sticky top-0 h-dvh`. Only the
        navigation list scrolls; the header and footer stay in place.
      */}
      <SidebarHeader className={cn("w-full", collapsed ? "justify-center gap-0 px-0" : "justify-between px-5")}>
        <button
          type="button"
          onClick={() => collapsed ? toggleCollapsed() : onSelect?.("dashboard")}
          aria-label={collapsed ? "Perluas sidebar" : "Ke Beranda"}
          title={collapsed ? "Perluas sidebar" : "Beranda"}
          className="h-10 w-10 shrink-0 rounded-full transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <img src="/favicon.png" alt="Shanti Catering" className="h-10 w-10 rounded-full object-cover" />
        </button>
        {!collapsed && !hideToggle && <SidebarToggle className="ml-auto" />}
      </SidebarHeader>

      {!collapsed && (
        <button
          type="button"
          onClick={() => onSelect?.("kasir")}
          className="mx-3 mt-4 flex h-10 w-auto shrink-0 self-stretch items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground shadow-sm transition-transform hover:brightness-105 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <UtilityIcon path="M12 5v14M5 12h14" />
          Transaksi Baru
        </button>
      )}

      <SidebarNav className="mt-3 gap-2.5 pb-1">
        <div className={cn("flex w-full flex-col gap-1.5", collapsed ? "items-center px-0" : "items-stretch px-3")}>
          {NAV.map((item) => (
            <Fragment key={item.id}>
              {item.id === "impor" && !collapsed && (
                <div aria-hidden="true" className="flex h-5 shrink-0 items-center overflow-hidden px-3">
                  <span className="whitespace-nowrap text-[9px] font-extrabold uppercase leading-none tracking-[0.08em] text-sidebar-foreground/45">
                    Menu
                  </span>
                </div>
              )}
              {item.id === "itsfood-dash" && !collapsed && (
                <div aria-hidden="true" className="flex h-5 shrink-0 items-center overflow-hidden px-3 mt-1">
                  <span className="whitespace-nowrap text-[9px] font-extrabold uppercase leading-none tracking-[0.08em] text-sidebar-foreground/45">
                    ITS Food
                  </span>
                </div>
              )}
              {renderItem(item)}
            </Fragment>
          ))}
        </div>
      </SidebarNav>

      <SidebarFooter className={cn("w-full border-t border-white/10 pt-3", collapsed ? "px-2" : "px-3")}>
        <div className={cn("flex gap-1", collapsed ? "flex-col items-center" : "flex-col")}>
          <button
            type="button"
            aria-label={dark ? "Mode terang" : "Mode gelap"}
            title={dark ? "Mode terang" : "Mode gelap"}
            onClick={() => setDark(!dark)}
            className={cn(
              "flex h-10 items-center rounded-xl text-[11px] font-semibold text-sidebar-foreground/75 transition-colors hover:bg-white/[0.07] hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/70",
              collapsed ? "w-10 justify-center" : "w-full gap-3 px-3",
            )}
          >
            <UtilityIcon path={dark
              ? "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
              : "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"} />
            {!collapsed && <span>{dark ? "Mode terang" : "Mode gelap"}</span>}
          </button>

          {!signingOut && (
            <button
              type="button"
              aria-label="Keluar"
              title="Keluar"
              onClick={() => {
                setSigningOut(true);
                void keluar();
              }}
              className={cn(
                "flex h-10 items-center rounded-xl text-[11px] font-semibold text-sidebar-foreground/75 transition-colors hover:bg-white/[0.07] hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/70",
                collapsed ? "w-10 justify-center" : "w-full gap-3 px-3",
              )}
            >
              <UtilityIcon path="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
              {!collapsed && <span>Keluar</span>}
            </button>
          )}
        </div>
      </SidebarFooter>
      <span id={navId} className="sr-only">Pilih halaman untuk membuka bagian aplikasi</span>
    </aside>
  );
}

export function Sidebar({
  active,
  onSelect,
  dark,
  setDark,
  forceExpanded,
  hideToggle,
  className,
}: {
  active: string;
  onSelect?: (id: string) => void;
  dark: boolean;
  setDark: (dark: boolean) => void;
  forceExpanded?: boolean;
  hideToggle?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);
  const effective = forceExpanded ? false : collapsed;
  const context = useMemo(() => ({ collapsed: effective, toggleCollapsed }), [effective, toggleCollapsed]);

  return (
    <SidebarContext.Provider value={context}>
      <SidebarContents active={active} onSelect={onSelect} dark={dark} setDark={setDark} hideToggle={hideToggle} className={className} />
    </SidebarContext.Provider>
  );
}
