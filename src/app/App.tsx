import { useEffect, useState, type ReactNode } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

import { Sidebar } from "@/components/sidebar";
import { ImporPesananPage } from "@/pages/impor-pesanan";
import { DataProvider, useData } from "@/lib/data-source";
import { AuthProvider, useAuth } from "@/lib/auth";
import { triggerSyncFromSheet } from "@/lib/sync-google-sheet";
import { IconButton } from "@/components/ui/card";
import { LayarMemuatMasuk, MasukPage } from "@/pages/masuk";
import { Beranda } from "@/pages/beranda";
import { KasirPage } from "@/pages/kasir";
import { PenjualanPage } from "@/pages/penjualan";
import { PiutangPage } from "@/pages/piutang";
import { CustomerPage } from "@/pages/customer";
import { PengaturanPage } from "@/pages/pengaturan";
import { MenuPage } from "@/pages/menu";

/* ==========================================================================
   App shell — sidebar + topbar + routing.
   Tema diputuskan sebelum hydration (lihat index.html) supaya tidak ada flash.
   ========================================================================== */

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
    <path d={d} />
  </svg>
);
const IcoSun = ico("M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z");
const IcoMoon = ico("M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z");
const IcoMenu = ico("M4 7h16M4 12h16M4 17h16");
const IcoKeluar = ico("M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6");

/* sidebar id <-> route */
const NAV_TO_ROUTE: Record<string, string> = {
  impor: "/impor",
  dashboard: "/",
  kasir: "/kasir",
  menu: "/menu",
  struk: "/penjualan",
  customer: "/customer",
  piutang: "/piutang",
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

/** Lencana status data: kasir harus bisa tahu layar sedang menampilkan
    angka Supabase atau angka contoh. Diam-diam memakai data contoh adalah
    cara tercepat membuat orang percaya angka yang salah. */
function DataBadge() {
  const { status, error, diambilPada, muatUlang } = useData();
  if (status === "memuat") {
    return (
      <span className="hidden h-10 items-center gap-1.5 rounded-full border border-input px-3 text-xs font-semibold text-muted-foreground md:inline-flex">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent"
        />
        Mengambil data
      </span>
    );
  }
  if (status === "gagal") {
    return (
      <button
        onClick={() => void muatUlang()}
        title={error ?? "Supabase tidak terbaca — ketuk untuk coba lagi"}
        className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#F3DBA2] px-3 text-xs font-bold text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]"
      >
        Data gagal dimuat · coba lagi
      </button>
    );
  }
  return (
    <span
      title={diambilPada ? `Terakhir diambil ${diambilPada.toLocaleTimeString("id-ID")}` : undefined}
      className="hidden h-10 items-center gap-1.5 rounded-full border border-input px-3 text-xs font-semibold text-muted-foreground md:inline-flex"
    >
      <span className="h-2 w-2 rounded-full bg-success" />
      Live
    </span>
  );
}

/** Sign out.
 *
 *  Present as an icon rather than a menu, because on a shared kiosk the next
 *  person must be able to lock the screen without hunting for it. Hidden on
 *  the narrowest phones where the topbar has no room and the session is
 *  short-lived anyway. */
function KeluarButton() {
  const { keluar } = useAuth();
  const [bekerja, setBekerja] = useState(false);
  if (bekerja) return null;
  return (
    <button
      aria-label="Keluar"
      title="Keluar"
      onClick={() => {
        setBekerja(true);
        void keluar();
      }}
      className="hidden h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-ring sm:grid"
    >
      {IcoKeluar}
    </button>
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
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:px-7">
        <button
          aria-label="Buka menu" onClick={() => setDrawer(true)}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-foreground lg:hidden"
        >
          {IcoMenu}
        </button>

        <button
          onClick={() => go("dashboard")}
          className="shrink-0 rounded-2xl px-2 py-1.5 hover:bg-muted"
        >
          {/* Di mobile nama brand tidak boleh wrap: topbar jadi dua baris
              dan tombol di sebelahnya tergeser. */}
          <span className="whitespace-nowrap text-base font-bold tracking-[-0.02em] lg:text-lg">
            Shanti Catering
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <DataBadge />
          <IconButton label={dark ? "Mode terang" : "Mode gelap"} onClick={() => setDark((d) => !d)}>
            {dark ? IcoSun : IcoMoon}
          </IconButton>
          <KeluarButton />
          <button
            onClick={() => go("kasir")}
            className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-primary px-3.5 font-semibold text-primary-foreground sm:px-4"
          >
            Transaksi Baru
          </button>
        </div>
      </header>

      <div className="flex min-h-[calc(100dvh-4rem)] flex-1">
        {/* Wrapper sidebar (desktop).

            Wrapper ini, bukan `<Sidebar>` itu sendiri, yang memegang
            sticky + centering. Alasannya tinggi wrapper harus berasal
            dari VIEWPORT, bukan dari isi halaman.

            Kalau centering ditaruh di nav (`sticky top-1/2
            -translate-y-1/2`), rail hanya bisa bergerak di dalam
            wrapper. Selama wrapper ikut tinggi halaman, ruinnya
            muncul: begitu halaman digulir atau input difokus (browser
            melakukan scroll-into-view, yang terjadi juga saat mengetik
            di kolom pencarian), wrapper tidak punya ruang untuk menahan
            rail di tengah dan rail ikut naik — persis bug yang dilapor.

            Di sini tinggi wrapper = tinggi viewport (`100dvh-4rem`,
            dikurangi tinggi header `h-16`), jadi:
            - `sticky top-16` → wrapper tetap menempel tepat di bawah
              header, tidak pernah ikut ter-scroll.
            - `justify-center` → rail selalu di tengah vertikal area
              itu, relatif terhadap viewport, stabil terhadap scroll
              maupun fokus input.
            - Tinggi tetap dari viewport sehingga rail tidak pernah
              bisa terdorong keluar area sticky. */}
        <div className="hidden shrink-0 lg:sticky lg:top-16 lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col lg:justify-center">
          <Sidebar active={activeNav} onSelect={go} />
        </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Tutup menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <motion.div
            initial={{ x: -100 }} animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute inset-y-0 left-0"
          >
            {/* Drawer tidak lewat wrapper sticky desktop, jadi rail
                di sini hanya butuh tinggi penuh layar. Sticky dan
                centering sudah menjadi tanggung jawab wrapper
                desktop di atas. */}
            <Sidebar active={activeNav} onSelect={go} className="!h-dvh" />
          </motion.div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <main className="px-4 py-5 lg:px-7 lg:py-6">
          <AnimatePresence mode="wait">
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
                <Route path="/pengaturan" element={<PengaturanPage />} />
              </Routes>
            </motion.div>
          </AnimatePresence>

        </main>
      </div>
      </div>
    </div>
  );
}
