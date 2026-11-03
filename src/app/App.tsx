import { useEffect, useState, type ReactNode } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

import { Sidebar } from "@/components/sidebar";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ImporPesananPage } from "@/pages/impor-pesanan";
import { ItsfoodDashboardPage } from "@/pages/itsfood-dashboard";
import { ItsfoodPage } from "@/pages/itsfood";
import { ItsfoodTagihanPage } from "@/pages/itsfood-tagihan";
import { ItsfoodProdukPage } from "@/pages/itsfood-produk";
import { DataProvider, useData } from "@/lib/data-source";
import { AuthProvider, useAuth } from "@/lib/auth";
import { triggerSyncFromSheet } from "@/lib/sync-google-sheet";
import { LayarMemuatMasuk, MasukPage } from "@/pages/masuk";
import { Beranda } from "@/pages/beranda";
import { KasirPage } from "@/pages/kasir";
import { PenjualanPage } from "@/pages/penjualan";
import { PiutangPage } from "@/pages/piutang";
import { CustomerPage } from "@/pages/customer";
import { PengaturanPage } from "@/pages/pengaturan";
import { MenuPage } from "@/pages/menu";

/* ==========================================================================
   App shell — sidebar + routing.
   Tema diputuskan sebelum hydration (lihat index.html) supaya tidak ada flash.
   ========================================================================== */

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
    <path d={d} />
  </svg>
);
const IcoMenu = ico("M4 7h16M4 12h16M4 17h16");

/* sidebar id <-> route */
const NAV_TO_ROUTE: Record<string, string> = {
  impor: "/impor",
  dashboard: "/",
  kasir: "/kasir",
  menu: "/menu",
  struk: "/penjualan",
  customer: "/customer",
  piutang: "/piutang",
  "itsfood-dash": "/itsfood-dashboard",
  "itsfood-orders": "/itsfood-orders",
  "itsfood-pay": "/itsfood-tagihan",
  "itsfood-produk": "/itsfood-produk",
  pengaturan: "/pengaturan",
};

export default function App() {
  return (
    <AuthProvider>
      <GerbangMasuk />
    </AuthProvider>
  );
}

/** Auth gate.
 *
 *  `DataProvider` sits inside the signed-in branch on purpose. It fetches on
 *  mount, and before this gate existed those fetches went out with the
 *  publishable key — which RLS now rejects, so every page would render an
 *  empty menu behind a login screen. Mounting it only once a session exists
 *  is what makes the two line up. */
function GerbangMasuk() {
  const { status } = useAuth();

  if (status === "memuat") return <LayarMemuatMasuk />;
  if (status === "belum") return <MasukPage />;

  return (
    <DataProvider>
      <AppShell />
    </DataProvider>
  );
}

/** Halaman yang hanya boleh dibuka di desktop (lg ke atas).
    Di bawah itu, user dipaksa balik ke Dashboard. */
function DesktopOnly({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  /* `useState` initializer, bukan `useEffect`: dengan effect, halaman
     Import sempat ter-render dulu sebelum redirect — user melihat sekilas
     form CSV yang memang tidak boleh muncul di sini.
     Sidebar `hidden` = item nav hilang; ini yang menutup route langsung
     dari URL atau riwayat browser. */
  const [desktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    if (!desktop) nav("/", { replace: true });
  }, [desktop, nav]);
  if (!desktop) return null;
  return <>{children}</>;
}

function AppShell() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [drawer, setDrawer] = useState(false);
  const { status, muatUlang } = useData();
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("kasir-theme", dark ? "dark" : "light");
  }, [dark]);

  /* Sinkron Google Sheet saat jendela mendapat fokus atau visibilitas
     berubah jadi terlihat. Non-bloking, silent. */
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        triggerSyncFromSheet();
      }
    };
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", handler);
    return () => {
      window.removeEventListener("focus", handler);
      document.removeEventListener("visibilitychange", handler);
    };
  }, []);

  // route -> sidebar aktif
  const activeNav =
    Object.entries(NAV_TO_ROUTE).find(([, r]) => r === loc.pathname)?.[0] ?? "dashboard";

  const go = (id: string) => {
    const r = NAV_TO_ROUTE[id] ?? "/";
    nav(r);
    setDrawer(false);
  };

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <header className="lg:hidden fixed top-0 z-30 flex h-11 w-full items-center border-b border-border bg-background/95 px-2 backdrop-blur">
        <button
          aria-label="Buka menu"
          onClick={() => setDrawer(true)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground"
        >
          {IcoMenu}
        </button>
      </header>

      {/* Desktop rail stays pinned to the viewport; navigation scrolls inside it. */}
      <div className="hidden shrink-0 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <Sidebar active={activeNav} onSelect={go} dark={dark} setDark={setDark} />
      </div>

      <AnimatePresence mode="wait">
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button aria-label="Tutup menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <motion.div
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute inset-y-0 left-0"
            >
              <Sidebar active={activeNav} onSelect={go} dark={dark} setDark={setDark} forceExpanded hideToggle className="!h-dvh" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="min-w-0 flex-1">
        <main className="flex-1 px-4 pt-12 pb-5 lg:px-7 lg:py-6">
          {status === "memuat" && (
            <div role="status" className="mb-4 rounded-xl border border-border bg-card/80 px-4 py-2.5 text-xs font-medium text-muted-foreground">
              Menghubungkan ke server...
            </div>
          )}
          {status === "gagal" && (
            <button
              type="button"
              onClick={() => void muatUlang()}
              className="mb-4 w-full rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-left text-xs font-semibold text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60"
            >
              Koneksi terputus · ketuk untuk muat ulang
            </button>
          )}
          <AnimatePresence mode="wait">
            {/* Boundary memakai key route: pindah halaman melepas error
                halaman sebelumnya, jadi user tidak terjebak di layar gagal. */}
            <ErrorBoundary key={loc.pathname} nama={loc.pathname === "/" ? "Dashboard" : loc.pathname.replace("/", "")}>
            <motion.div
              key={loc.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <Routes location={loc}>
                <Route path="/" element={<Beranda />} />
                {/* Import Pesanan = desktop only (sama seperti nav itemnya).
                    Di bawah lg form CSV 9 kolom tidak masuk akal, jadi buka
                    /impor dari tablet/phone dialihkan ke Dashboard. */}
                <Route
                  path="/impor"
                  element={<DesktopOnly>{<ImporPesananPage />}</DesktopOnly>}
                />
                <Route path="/kasir" element={<KasirPage />} />
                <Route path="/menu" element={<MenuPage />} />
                <Route path="/penjualan" element={<PenjualanPage />} />
                <Route path="/piutang" element={<PiutangPage />} />
                <Route path="/customer" element={<CustomerPage />} />
                <Route path="/itsfood-dashboard" element={<ItsfoodDashboardPage />} />
                <Route path="/itsfood-orders" element={<ItsfoodPage />} />
                <Route path="/itsfood-tagihan" element={<ItsfoodTagihanPage />} />
                <Route path="/itsfood-produk" element={<ItsfoodProdukPage />} />
                <Route path="/pengaturan" element={<PengaturanPage />} />
              </Routes>
            </motion.div>
            </ErrorBoundary>
          </AnimatePresence>

        </main>
      </div>
    </div>
  );
}
