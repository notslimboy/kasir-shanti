import { cn } from "@/lib/utils";

/* ==========================================================================
   Sidebar — icon only, 88px, forest, active = lime icon + lime bar kiri
   (mengikuti design/reference.png)
   Mobile: Drawer, bukan bottom bar.
   ========================================================================== */

/* `desktopOnly`: Import Pesanan hanya muncul di desktop (lg ke atas).
   Impor CSV butuh keyboard/trackpad dan tabel 9 kolom yang melebar —
   di tablet dan phone form-nya bukan tempat yang masuk akal. Di bawah lg
   item ini disembunyikan (tidak dihapus) supaya route-nya tetap bisa
   dibuka langsung dari URL desktop. */
type NavItem = { id: string; label: string; icon: IkonNama; desktopOnly?: boolean };

const NAV: readonly NavItem[] = [
  { id: "impor", label: "Import Pesanan", icon: "import", desktopOnly: true },
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "kasir", label: "Kasir", icon: "cart" },
  { id: "menu", label: "Menu", icon: "box" },
  { id: "struk", label: "Struk", icon: "receipt" },
  { id: "customer", label: "Customer", icon: "users" },
  { id: "piutang", label: "Piutang", icon: "wallet" },
  { id: "pengaturan", label: "Pengaturan", icon: "cog" },
] as const;

type IkonNama =
  | "grid"
  | "import"
  | "cart"
  | "box"
  | "receipt"
  | "users"
  | "wallet"
  | "chart"
  | "cog";

function Icon({ name }: { name: IkonNama }) {
  const p = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    import: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
    cart: "M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20.5 8H6M9.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    box: "M12 3 3 7.5v9L12 21l9-4.5v-9L12 3ZM3 7.5 12 12l9-4.5M12 12v9",
    receipt: "M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5L6 21V3ZM9 8h6M9 12h6",
    users: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0M16 11a3 3 0 1 0 0-6M15 15.5a5 5 0 0 1 6 4.5",
    wallet: "M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 3-3h10M17 13h.01",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.15-1.5l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14.5 2h-4l-.35 2.5A8 8 0 0 0 7.55 6L5.1 5 3.1 8.4l2 1.6a8 8 0 0 0 0 3l-2 1.6L5.1 18l2.45-1a8 8 0 0 0 2.6 1.5L10.5 22h4l.35-2.5a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6A8 8 0 0 0 20 12Z",
  }[name];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d={p} />
    </svg>
  );
}

export function Sidebar({
  active,
  onSelect,
  className,
}: {
  active: string;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  return (
    <nav
      /* Nav ini SENGAJA TIDAK sticky dan SENGAJA TIDAK menengahkan diri
         sendiri lagi.

         Riwayat bug (semua berasal dari satu kesalahan: centering
         ditambahkan di nav):
         1. `overflow-y-auto` di nav → logo ikut ter-scroll hilang.
            Diperbaiki: wrapper daftar yang scroll, bukan nav.
         2. `sticky top-0` → rail meluncur ke belakang header `sticky
            h-16` yang opaque, jadi logo ketutup header.
         3. `sticky top-1/2 -translate-y-1/2` → rail terlihat center
            TAPI naik lagi begitu halaman discroll atau input difokus
            (browser scroll-into-view). Root cause: elemen sticky hanya
            bisa bergerak di dalam containing block-nya, dan containing
            block itu wrapper App yang tingginya ikut ISI HALAMAN. Di
            halaman pendek atau setelah scroll, wrapper tidak punya
            ruang untuk menahan rail di tengah, sehingga rail ikut naik
            bersama flow.

         Solusinya memindahkan\centering ke WRAPPER (lihat App.tsx):
         wrapper jadi `sticky top-16 h-[calc(100dvh-4rem)] flex
         flex-col justify-center` — tinggi dari VIEWPORT, bukan dari
         konten, jadi rail punya tempat yang stabil untuk di tengah
         dan tidak pernah bergerak saat halaman digulir atau input
         difokus.

         Karena itu nav di sini cukup jadi wadah isinya saja:
         - `max-h-full`      → rail tidak pernah lebih tinggi dari
           wrapper, jadi `justify-center` selalu punya hasil yang benar
           dan daftar tetap punya ruang untuk scroll sendiri.
         - `overflow-y-auto` TIDAK ada di nav → yang scroll hanya
           wrapper daftar di bawah (`flex-1 min-h-0`), sehingga logo
           terkunci di atas rail. */
      className={cn(
        /* Radius 28px (bukan 24px): di rail setebal 88px, sudut 24px
           masih terbaca sebagai "tombol besar", sedangkan 28px+ membaca
           sebagai panel. Tombolnya dibulatkan lebih kecil (14px) supaya
           hierarkinya jelas: rail = bentuk, tombol = target. */
        "flex max-h-full w-[88px] shrink-0 flex-col items-center " +
          "rounded-r-[28px] bg-sidebar py-4",
        className,
      )}
      aria-label="Navigasi utama"
    >
      {/* Logo — merangkap tombol ke Beranda.

          Di mobile nama brand di topbar sudah dihapus, jadi logo inilah satu-
          satunya jalan pulang ke dashboard selain ikon di daftar bawah. Karena
          itu ia tombol, bukan gambar mati: yang mencarinya akan menekannya.

          Memakai logo brand Shanti (public/favicon.png) yang sudah ada di
          aset, bukan placeholder huruf "K" lagi.

          Logo ini bulat dengan latar krem, jadi BUKAN diletakkan di kotak
          `bg-primary` seperti placeholder — kotak hijau tua di belakang
          hanya akan menutupi sebagian lingkaran kremnya dan membuat dua
          bentuk bertumpuk. Dipakai bulat apa adanya.

          `/favicon.png` (bukan `/icon.png`) karena file itu satu-satunya
          logo brand yang sudah berada di `public/`, jadi tidak perlu
          menyalin aset 59KB ke repo dan tetap ikut terbawa saat build. */}
      <button
        type="button"
        onClick={() => onSelect?.("dashboard")}
        aria-label="Ke Beranda"
        title="Beranda"
        className="mb-5 h-10 w-10 shrink-0 rounded-full transition-transform hover:scale-105 active:scale-95"
      >
        <img
          src="/favicon.png"
          alt="Shanti Catering"
          className="h-10 w-10 rounded-full object-cover"
        />
      </button>

      {/* Wrapper daftar: satu-satunya bagian yang scroll.

          `min-h-0` wajib: tanpa itu flex item tidak mau shrink di bawah
          isinya, wrapper memaksa nav melewati `max-h-full`, dan tidak
          ada yang bisa digulir. `overscroll-contain` mencegah gesture
          di ujung daftar merambat ke halaman. Logo di atas wrapper
          terkunci, tidak pernah ikut bergeser. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overscroll-contain">
      {NAV.map((n) => {
        const isActive = n.id === active;
        return (
          <button
            key={n.id}
            onClick={() => onSelect?.(n.id)}
            aria-current={isActive ? "page" : undefined}
            title={n.label}
            className={cn(
              /* 46px di rail 88px menyisakan 21px tiap sisi — ruang cukup
                 untuk penanda aktif tanpa harus keluar dari rail. */
              "relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] transition-colors",
              /* Item desktop-only: sembunyi di tablet/phone, muncul di lg+ */
              n.desktopOnly && "hidden lg:grid",
              isActive
                ? "bg-white/10 text-sidebar-primary"
                : "text-sidebar-foreground/55 hover:bg-white/5 hover:text-sidebar-foreground",
            )}
          >
            {isActive && (
              /* Penanda aktif DI DALAM rail (left-0). Semuanya -left-[18px]
                 keluar dari rail, ikut terpotong sudut membulatnya, dan
                 terlihat seperti render yang bocor ke halaman. */
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
            )}
            <Icon name={n.icon} />
            <span className="sr-only">{n.label}</span>
          </button>
        );
      })}
      </div>
    </nav>
  );
}
