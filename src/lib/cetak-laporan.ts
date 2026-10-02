import { CSS_LAPORAN } from "./laporan-css";
import {
  LEBAR_ISI_LAPORAN,
  MARGIN_LAPORAN,
  TINGGI_ISI_LAPORAN,
  UKURAN_HALAMAN_LAPORAN,
  labelRentang,
  laporanPenjualanHtml,
  type OpsiLaporan,
} from "./laporan";

/* ==========================================================================
   Cetak laporan penjualan.

  Dialog print dipanggil dari iframe off-screen yang lebarnya benar-benar
   millimeter (190mm isi + 10mm margin dua sisi). Kalau iframe-nya dibatasi
   max-width:100% seperti pratinjau struk, kertas keluar lebih sempit dari
   210mm dan tabel meluber ke sheet berikutnya.

   Dokumen ini memakai kelas report-print-mode pada <html> persis seperti
   aplikasi lama — CSS halaman (break-after page, tinggi terkunci) di selector
   itu, dan tanpa kelas itu semua aturan itu tidak berlaku.
   ========================================================================== */

export function dokumenLaporan(opsi: OpsiLaporan): string {
  const html = laporanPenjualanHtml(opsi);
  return `<!doctype html>
<html lang="id" class="report-print-mode">
<head>
<meta charset="utf-8" />
<title>Laporan Penjualan</title>
<style>
:root {
  --report-page-size: ${UKURAN_HALAMAN_LAPORAN};
  --report-page-margin: ${MARGIN_LAPORAN};
  --report-print-width: ${LEBAR_ISI_LAPORAN};
  --report-print-height: ${TINGGI_ISI_LAPORAN};
}
${CSS_LAPORAN}
</style>
</head>
<body>
${html}
</body>
</html>`;
}

/** Panggil dialog cetak browser. Mengembalikan dokumen yang dicetak supaya
    bisa diuji tanpa benar-benar membuka dialog. */
export function cetakLaporan(opsi: OpsiLaporan): string {
  const doc = dokumenLaporan(opsi);
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-same-origin allow-modals");
  f.setAttribute("aria-hidden", "true");
  f.style.position = "fixed";
  f.style.left = "-10000px";
  f.style.top = "0";
  f.style.width = `calc(${LEBAR_ISI_LAPORAN} + ${MARGIN_LAPORAN} * 2)`;
  f.style.height = "1px";
  f.style.border = "0";
  f.srcdoc = doc;
  document.body.appendChild(f);

  const jalankan = () => {
    const w = f.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
    // Beri waktu dialog print selesai, lalu buang frame-nya supaya tidak
    // menumpuk setiap kali laporan dicetak ulang.
    setTimeout(() => f.remove(), 1500);
  };
  f.addEventListener("load", jalankan, { once: true });
  if (f.contentDocument?.readyState === "complete") setTimeout(jalankan, 0);
  return doc;
}

export { labelRentang };
