import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/* ==========================================================================
   Tooltip teks penuh.

   BUKAN atribut `title` bawaan browser. Alasannya nyata, bukan selera:

   - `title` muncul setelah jeda sekitar satu detik, muncul-tenggelam
     sendiri, dan posisinya tidak bisa diatur. Di tabel struk yang penuh,
     tooltip yang melayang entah ke mana menutupi baris di bawahnya.
   - `title` tidak bisa diberi gaya. Warnanya mengikuti sistem operasi,
     dan di layar kasir yang dipakai seharian hasilnya apa adanya.
   - Di Android `title` praktis tidak pernah muncul, jadi kasir di HP
     tidak pernah punya jalan melihat teks yang terpotong.
   - `title` tidak disampaikan screen reader sebagai keterangan terpisah.

   Yang dipakai di sini: portal ke body, posisi dihitung dari kotak
   elemen, otomatis ke atas kalau tidak ada ruang di bawah, dan posisi
   horizontal dijepit agar tidak keluar layar.
   ========================================================================== */

const JARAK = 8;

/* Jarak bubble dari tepi viewport. Kalau lebih kecil, bubble menempel
   ke tepi dan terbaca sebagai bagian dari halaman, bukan lapisan yang
   sengaja muncul. */
const TEPI = 8;

type Posisi = { atas: number; kiri: number };

type PropsPemicu = {
  ref: React.RefObject<HTMLElement | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  "aria-describedby": string | undefined;
};

export function Tooltip({
  teks,
  children,
  bubbleClassName,
  maksLebar = 320,
}: {
  /** Isi tooltip. String kosong berarti tidak ada tooltip sama sekali. */
  teks: string;
  /** Elemen pemicunya. */
  children: (props: PropsPemicu) => React.ReactNode;
  bubbleClassName?: string;
  /** Lebar maksimum bubble. */
  maksLebar?: number;
}) {
  const id = useRef(`tip-${Math.random().toString(36).slice(2, 9)}`);
  const pemicu = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement | null>(null);
  const [lewat, setLewat] = useState(false);
  const [posisi, setPosisi] = useState<Posisi | null>(null);

  /* Tanpa jeda: kasir menyorot baris sambil membaca, bukan berhenti
     khusus untuk mengarahkan kursor. Tooltip yang telat sama dengan
     tooltip yang tidak ada. */
  const buka = useCallback(() => setLewat(true), []);
  const tutup = useCallback(() => setLewat(false), []);

  /* Posisi dihitung setelah bubble dirender, karena lebar bubble baru
     diketahui setelah teksnya membungkus. */
  useLayoutEffect(() => {
    if (!lewat) {
      setPosisi(null);
      return;
    }
    const hitung = () => {
      const p = pemicu.current?.getBoundingClientRect();
      const b = bubble.current?.getBoundingClientRect();
      if (!p || !b) return;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      /* Ruang di bawah dihitung dari sisa viewport dikurangi tinggi
         bubble itu sendiri. Kalau tidak, bubble akan memutuskan "ada
         ruang" dari tinggi layar, bukan dari ruang yang benar-benar
         tersisa. */
      const ruangBawah = vh - p.bottom - JARAK - TEPI;
      let atas: number;
      if (ruangBawah >= b.height) {
        atas = p.bottom + JARAK;
      } else if (p.top - b.height - JARAK >= TEPI) {
        /* Tidak muat di bawah, muat di atas. Kalau dua-duanya tidak
           muat, pakai yang muat: bubble yang menutupi targetnya sendiri
           lebih buruk daripada bubble yang sedikit lebih tinggi. */
        atas = p.top - b.height - JARAK;
      } else {
        atas = Math.max(TEPI, vh - b.height - TEPI);
      }
      const kiri = Math.min(
        Math.max(TEPI, p.left + p.width / 2 - b.width / 2),
        Math.max(TEPI, vw - b.width - TEPI),
      );
      setPosisi({ atas, kiri });
    };
    hitung();
    /* true = tangkap juga scroll di dalam container. Tanpa itu, tabel
       yang bisa digulir akan meninggalkan tooltipnya di tempat lama
       sementara isinya sudah bergeser. */
    window.addEventListener("scroll", hitung, true);
    window.addEventListener("resize", hitung);
    return () => {
      window.removeEventListener("scroll", hitung, true);
      window.removeEventListener("resize", hitung);
    };
  }, [lewat, teks]);

  /* Escape menutup tooltip. Tanpa ini, tooltip yang sudah menutupi
     beberapa baris tidak bisa dibuang dari keyboard, dan satu-satunya
     jalan keluar adalah mouseleave yang tidak pernah terjadi kalau
     pengguna memakai keyboard. */
  useEffect(() => {
    if (!lewat) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tutup();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lewat, tutup]);

  const isi = teks.trim();

  if (isi === "") {
    return (
      <>
        {children({
          ref: pemicu,
          onMouseEnter: buka,
          onMouseLeave: tutup,
          onFocus: buka,
          onBlur: tutup,
          "aria-describedby": undefined,
        })}
      </>
    );
  }

  return (
    <>
      {children({
        ref: pemicu,
        onMouseEnter: buka,
        onMouseLeave: tutup,
        onFocus: buka,
        onBlur: tutup,
        /* Hanya aria-describedby, bukan aria-label: aria-label akan
           menggantikan nama aksesibel elemen, sementara teks yang tampil
           sudah benar. Yang hilang hanya bagian yang terpotong, jadi itu
           yang perlu disampaikan. */
        "aria-describedby": lewat ? id.current : undefined,
      })}
      {lewat &&
        createPortal(
          <div
            ref={bubble}
            id={id.current}
            role="tooltip"
            style={{
              ...(posisi ? { top: posisi.atas, left: posisi.kiri } : { top: -9999, left: -9999 }),
              maxWidth: maksLebar,
              /* Diukur dulu, baru terlihat: bubble yang tampil dengan
                 posisi sembarang akan berkedip di tempat yang salah
                 sesaat sebelum melompat ke tempat yang benar. */
              visibility: posisi ? "visible" : "hidden",
            }}
            className={cn(
              "pointer-events-none fixed z-[100] whitespace-normal break-words rounded-xl border border-border bg-card px-3 py-2",
              "text-xs leading-relaxed text-foreground shadow-pop",
              bubbleClassName,
            )}
          >
            {isi}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ==========================================================================
   Teks yang dipotong, dengan tooltip hanya kalau memang terpotong.

   Bersyarat disengaja: tooltip yang muncul untuk teks yang sudah utuh
   tidak menambah informasi apa pun, dan setelah ada beberapa dozen baris,
   tooltip yang selalu muncul membuat kasir berhenti melihat tooltip
   sama sekali.
   ========================================================================== */

export function TeksPotong({
  teks,
  className,
  maksLebar,
}: {
  teks: string;
  className?: string;
  /** Batas pemotongan CSS. */
  maksLebar?: string | number;
}) {
  const [terpotong, setTerpotong] = useState(false);
  const pemicu = useRef<HTMLSpanElement | null>(null);

  /* Diperiksa setelah render, karena lebar teks yang tergambar baru
     diketahui setelah browser menghitungnya. */
  useLayoutEffect(() => {
    const n = pemicu.current;
    if (!n) return;
    /* Toleransi satu piksel. Lebar di browser bisa pecah pecahan, jadi
       teks yang pas persis di batas kolom bisa terbaca sebagai
     melebar satu piksel dan mendapat tooltip yang isinya sama dengan
       teks yang sudah terbaca. */
    setTerpotong(n.scrollWidth > n.clientWidth + 1);
  }, [teks, maksLebar, className]);

  return (
    <Tooltip teks={terpotong ? teks : ""}>
      {(p) => (
        <span
          ref={(n) => {
            pemicu.current = n;
            p.ref.current = n;
          }}
            onMouseEnter={p.onMouseEnter}
          onMouseLeave={p.onMouseLeave}
          onFocus={p.onFocus}
          onBlur={p.onBlur}
          aria-describedby={p["aria-describedby"]}
          /* `title` sengaja tidak dipasang. Tooltip di sini adalah
             komponen, bukan atribut. */
          className={cn("block min-w-0 truncate", className)}
            style={maksLebar ? { maxWidth: maksLebar } : undefined}
          >
          {teks}
        </span>
      )}
    </Tooltip>
  );
}