import {
  cssStruk,
  lebarCetakMm,
  strukHtml,
  tipografiStruk,
  STRUK_DEFAULT,
  type DataStruk,
  type SetelanStruk,
} from "./struk";

/* ==========================================================================
   Cetak struk thermal — mekanismenya disalin dari script.js lama
   (printReceiptHtmlInFrame, measureReceiptBatchPageHeight).

   Kenapa iframe tersembunyi dan bukan window.open():
   -Dialog cetak pindah fokus ke jendela baru, kasir kehilangan konteks
     aplikasi dan sempat mengira prosesnya selesai.
   - Ukuran kertas harus dalam millimeter (@page), dan itu hanya bisa
     dipasang di dokumen yang kita tulis sendiri.
   - Bisa lebih dari satu struk dalam satu panggilan cetak (batch), tanpa
     mengonfirmasi dialog berulang-ulang.

   Pratinjau di halaman sengaja TIDAK dipakai untuk mencetak: iframe
   pratinjau dibatasi max-width:100% supaya muat di kolomnya, dan itu membuat
   kertas tercetak lebih sempit dari 48/72mm.
   ========================================================================== */

/** Buffer dan batas minimum tinggi halaman, sama seperti versi lama. */
const BUFFER_MM = 0.5;
const MINIMAL_MM = 30;
/** Batas tunggu tiap sumber (gambar, font, layout). */
const TIMEOUT_MS = 2000;

export type CetakStruk = {
  /** HTML isi struk (hasil strukHtml). */
  html: string;
  setelan?: SetelanStruk;
  /** Nomor struk dipakai untuk teaser di tag <title>. */
  judul?: string;
};

/** px → mm, lalu naikkan sedikit supaya baris terakhir tidak terpotong. */
export function tinggiHalamanMm(tinggiPx: number): number {
  const mm = (Math.max(Number(tinggiPx) || 0, 0) * 25.4) / 96;
  return Math.max(Math.ceil(mm + BUFFER_MM), MINIMAL_MM);
}

/** Beberapa struk disambung jadi satu dokumen; pemisah antar struk. */
export function gabungStruk(list: CetakStruk[]): string {
  const batch = list.length > 1;
  return list
    .map((s, i) => {
      const pemisah = batch && i > 0 ? '<div class="receipt-batch-separator" aria-hidden="true"></div>' : "";
      return `${pemisah}<article class="receipt-paper${batch ? " batch-receipt" : ""}">${s.html}</article>`;
    })
    .join("");
}

/** Dokumen lengkap untuk iframe cetak: CSS struk + aturan @page. */
function dokumenCetak(list: CetakStruk[], tinggiMm: number | "auto", setelan: SetelanStruk): string {
  const lebarCetak = lebarCetakMm(setelan.receiptWidth);
  const ukuran = `size: ${lebarCetak}mm ${tinggiMm === "auto" ? "auto" : `${tinggiMm}mm`};`;
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8">
    <title>Struk Belanja</title>
    <style>${cssStruk(setelan)}</style>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; }
      .print-area { display: block; width: ${lebarCetak}mm; margin: 0; padding: 0; color: #111; background: #fff; }
      @media print {
        @page { ${ukuran} margin: 0mm; }
        html, body {
          width: ${lebarCetak}mm; min-width: ${lebarCetak}mm; height: auto !important;
          min-height: 0 !important; overflow: visible !important; margin: 0; padding: 0; background: #fff;
        }
        .print-area { position: static !important; display: block !important; width: ${lebarCetak}mm; margin: 0; padding: 0; }
        .batch-receipt { height: auto !important; min-height: 0 !important; break-inside: avoid !important; page-break-inside: avoid !important; }
      }
    </style>
  </head>
  <body>
    <div class="print-area">${gabungStruk(list)}</div>
  </body>
</html>`;
}

/* Dokumen host perlu tahu token struk yang sama supaya halaman aplikasi dan
   hasil cetak memakai ukuran huruf yang sama. */
function cssDenganToken(setelan: SetelanStruk): void {
  const t = tipografiStruk(setelan.receiptFontSize);
  const root = document.documentElement;
  root.style.setProperty("--receipt-width", `${setelan.receiptWidth}mm`);
  root.style.setProperty("--receipt-print-width", `${lebarCetakMm(setelan.receiptWidth)}mm`);
  root.style.setProperty("--receipt-font-size", t.body);
  root.style.setProperty("--receipt-small-font-size", t.small);
  root.style.setProperty("--receipt-emphasis-font-size", t.emphasis);
  root.style.setProperty("--receipt-heading-font-size", t.heading);
  root.style.setProperty("--receipt-total-font-size", t.total);
}

const tunggu = (p: Promise<unknown>, ms = TIMEOUT_MS) =>
  Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

/** Tunggu dokumen siap: layout + gambar + font. Cetak terlalu cepat
    menghasilkan kertas kosong atau logo terpotong. */
async function tungguSiap(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc) return;
  if (doc.readyState !== "complete") {
    await tunggu(new Promise((r) => frame.addEventListener("load", r, { once: true })), 1500);
  }
  await Promise.all(
    [...frame.contentDocument!.images].map((img) =>
      img.complete ? Promise.resolve() : tunggu(new Promise((r) => img.addEventListener("load", r, { once: true }))),
    ),
  );
  await tunggu(frame.contentDocument!.fonts?.ready ?? Promise.resolve());
}

/**
 * Cetak satu atau beberapa struk.
 *
 * Tinggi struk diukur DI DALAM iframe cetak, lalu dokumen ditulis ulang
 * dengan tinggi milimeter itu. Mengukur di dokumen host tidak bisa dipakai:
 * CSS struk hanya hidup di dalam iframe, jadi tinggi di host akan selalu
 * keliru dan baris terakhir bisa terpotong.
 */
export async function cetakStruk(
  list: CetakStruk[],
  setelan: SetelanStruk = STRUK_DEFAULT,
): Promise<void> {
  if (!list.length) return;
  cssDenganToken(setelan);

  document.querySelectorAll(".receipt-print-frame").forEach((f) => f.remove());
  const frame = document.createElement("iframe");
  frame.className = "receipt-print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const tulis = async (tinggiMm: number | "auto") => {
    const doc = frame.contentDocument;
    if (!doc) return false;
    doc.open();
    doc.write(dokumenCetak(list, tinggiMm, setelan));
    doc.close();
    await tungguSiap(frame);
    return true;
  };

  if (!(await tulis("auto"))) {
    frame.remove();
    window.print();
    return;
  }

  const area = frame.contentDocument?.querySelector(".print-area");
  const tinggi = tinggiHalamanMm(area?.getBoundingClientRect().height ?? 0);
  if (tinggi > 0) await tulis(tinggi);

  const w = frame.contentWindow;
  if (!w) {
    frame.remove();
    window.print();
    return;
  }
  w.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 60_000), { once: true });
  w.focus();
  w.print();
  /* Kalau dialog cetak tidak muncul (mis. printer diblokir), frame jangan
     menggantung di DOM selamanya. */
  setTimeout(() => frame.remove(), 60_000);
}

/** Cetak satu struk — bentuk yang dipakai kasir setelah pembayaran. */
export function cetakStrukSatuan(data: DataStruk, setelan: SetelanStruk = STRUK_DEFAULT): Promise<void> {
  return cetakStruk([{ html: strukHtml(data, setelan), setelan }], setelan);
}