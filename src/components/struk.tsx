import { forwardRef, useImperativeHandle, useMemo, useState } from "react";

import {
  cssStruk,
  lebarCetakMm,
  logoStruk,
  normalisasiCatatanKirim,
  strukHtml,
  STRUK_DEFAULT,
  type DataStruk,
  type SetelanStruk,
} from "@/lib/struk";

/* ==========================================================================
   Struk — dipakai di tiga tempat, dan ketiganya harus menghasilkan
   dokumen yang sama persis:

     1. pratinjau di halaman Struk & Pengaturan
     2. hasil cetak ke printer thermal / dialog cetak browser
     3. tampilan di layar Kasir

   Karena itu struk dibangun sebagai STRING HTML di lib/struk.ts, lalu
   dipasang lewat iframe. Kalau nanti diganti jadi JSX, ketiganya bisa
   diam-diam berbeda — dan itu justru yang dilarang.
   ========================================================================== */

export type StrukHandle = {
  /** HTML final, siap dicetak. */
  html: () => string;
  /** Meminta dialog cetak browser. */
  cetak: () => void;
};

type Props = {
  data: DataStruk;
  setelan?: SetelanStruk;
  className?: string;
};

export const Struk = forwardRef<StrukHandle, Props>(function Struk(
  { data, setelan = STRUK_DEFAULT, className = "" },
  ref,
) {
  const [tinggi, setTinggi] = useState<number | null>(null);
  const html = useMemo(() => strukHtml(data, setelan), [data, setelan]);
  const css = useMemo(() => cssStruk(setelan), [setelan]);
  const doc = useMemo(
    () => `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>${css}</style></head><body><article class="receipt-paper">${html}</article></body></html>`,
    [css, html],
  );

  useImperativeHandle(
    ref,
    () => ({
      html: () => doc,
      /* Pratinjau sengaja TIDAK dipakai untuk mencetak. Frame pratinjau
         dibatasi max-width:100% supaya muat di kolom pengaturan, dan itu
         membuat kertas tercetak jadi lebih sempit dari 48/72mm. Jadi cetak
         lewat frame sendiri yang lebarnya benar-benar millimeter. */
      cetak: () => {
        const lebarCetak = `${lebarCetakMm(setelan.receiptWidth)}mm`;
        const f = document.createElement("iframe");
        f.setAttribute("sandbox", "allow-same-origin allow-modals");
        f.style.position = "fixed";
        f.style.left = "-10000px";
        f.style.top = "0";
        f.style.width = lebarCetak;
        f.style.height = "1px";
        f.style.border = "0";
        f.srcdoc = doc;
        document.body.appendChild(f);
        const jalankan = () => {
          const w = f.contentWindow;
          if (!w) return;
          w.focus();
          w.print();
          // Beri waktu dialog print selesai, lalu buang frame-nya.
          setTimeout(() => f.remove(), 1000);
        };
        f.addEventListener("load", jalankan, { once: true });
        // Kalau dokumen sudah selesai sebelum listener dipasang.
        if (f.contentDocument?.readyState === "complete") setTimeout(jalankan, 0);
      },
    }),
    [doc, setelan.receiptWidth],
  );

  /* Tinggi iframe mengikuti isi struk. Tanpa ini frame-nya tinggi 0 karena
     induknya tidak punya tinggi, dan pratinjau hanya kelihatan 1–2 baris
     pertama — persis bagian yang paling tidak penting. */
  const sesuaikanTinggi = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const d = (e.target as HTMLIFrameElement).contentDocument;
    if (!d?.body) return;
    const h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight);
    if (h > 0) setTinggi(Math.ceil(h) + 2);
  };

  return (
    <iframe
      title="Pratinjau struk"
      /* allow-same-origin wajib supaya window.print() dari luar benar-benar
         memanggil dialog cetak, dan supaya strutknya bisa diperiksa saat
         pengujian. Isinya HTML yang kita susun sendiri (semua teks sudah
         di-escape di lib/struk.ts), jadi tidak ada konten tak tepercaya di
         dalam frame ini. allow-scripts sengaja TIDAK diberikan: struknya
         statis. */
      sandbox="allow-same-origin allow-modals"
      className={"block w-full border-0 bg-transparent " + className}
      /* srcDoc berubah -> frame dimuat ulang -> onLoad jalan lagi ->
         tinggi ikut menyesuaikan isi struk yang baru. */
      key={doc}
      onLoad={sesuaikanTinggi}
      style={{ height: tinggi ? `${tinggi}px` : "240px" }}
      srcDoc={doc}
    />
  );
});

/* -------------------------------------------------------------------------
   Data contoh untuk pratinjau di Pengaturan
   ---------------------------------------------------------------------- */

export function strukContoh(): DataStruk {
  return {
    receiptNo: "SH-20260930-0063",
    payment: "Tunai",
    customerName: "PURI ASRI P3 NO 32",
    chatDate: "30/09/2026 09.12",
    queueNo: 63,
    sendNote: "",
    subtotal: 241_000,
    shipping: 15_000,
    total: 256_000,
    items: [
      { name: "Ayam Goreng BaPut", variant: "Normal", qty: 3, price: 30_000 },
      { name: "Ayam Goreng BaPut", variant: "Separuh", qty: 1, price: 15_000 },
      { name: "Nasi Goreng", variant: "Normal", qty: 2, price: 20_000 },
      { name: "Es Kopi Susu", variant: "Normal", qty: 2, price: 18_000 },
      { name: "Sayur Asem Bening", variant: "Normal", qty: 1, price: 20_000, note: "kuah banyak" },
      { name: "Jus Alpukat", variant: "Normal", qty: 2, price: 20_000 },
    ],
  };
}

export { logoStruk, normalisasiCatatanKirim };
