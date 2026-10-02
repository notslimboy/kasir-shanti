import { namaItemKot } from "./kot";

/* ==========================================================================
   Struk & printer thermal — PORT dari aplikasi lama (script.js + styles.css).

   Aturan yang tidak boleh dilanggar: bentuk struk TIDAK BERUBAH. Struk yang
   sudah keluar dari printer warmer punya bentuk tertentu, dan kasir /
   pelanggan membacanya dengan cara tertentu. Menata ulang berarti membingungkan
   semua orang yang sudah terbiasa.

   Yang dipindah apa adanya:
     - lebar kertas default 58mm (bukan 80), isi 48mm
     - logo therma per lebar: 256px untuk 58mm, 320px untuk 80mm
     - urutan baris: logo, nama toko, alamat, customer, no antre/catatan kirim,
       item, subtotal, ongkir, potongan deposit, pembayaran, TOTAL BAYAR, footer
     - font: Courier New, tebal, tanpa sudut membulat
   ========================================================================== */

export type LebarStruk = "58" | "80";

export type SetelanStruk = {
  storeName: string;
  storeAddress: string;
  footer: string;
  receiptWidth: LebarStruk;
  receiptFontSize: "small" | "medium" | "large";
  receiptMode: "complete" | "compact";
};

/* Nilai ini disalin apa adanya dari initialState di script.js. */
export const STRUK_DEFAULT: SetelanStruk = {
  storeName: "Shanti Catering",
  storeAddress: "BHASKARA III / 38",
  footer: "== TERIMA KASIH ==",
  receiptWidth: "58",
  receiptFontSize: "large",
  receiptMode: "complete",
};

/* Di portabel sungguhan: esc-pos, potong sebagian, tanpa feed. */
export const PRINTER_DEFAULT = Object.freeze({
  language: "esc-pos",
  cut: "partial",
  feedLines: 0,
  nativePrinterTransport: "bluetooth",
  nativePrinterPort: "9100",
  autoPrint: true,
  printFlow: "direct",
});

/** Lebar area cetak di dalam kertas. 58mm → 48mm, 80mm → 72mm. */
export function lebarCetakMm(lebar: LebarStruk): 48 | 72 {
  return lebar === "58" ? 48 : 72;
}

/** Logo dipakai printer Thermal: gambar 1-bit, bukan foto. */
export function logoStruk(lebar: LebarStruk): string {
  return lebar === "58"
    ? "/thermal/logo-thermal-256-threshold.png"
    : "/thermal/logo-thermal-320-threshold.png";
}

/** Lebar logo di kertas saat dicetak: 58mm → 128px, 80mm → 160px. */
export function lebarLogoCetakPx(lebar: LebarStruk): 128 | 160 {
  return lebar === "80" ? 160 : 128;
}

/** DIPOR: RECEIPT_FONT_SIZES. */
export const UKURAN_FONT_STRUK = {
  small: { body: 11, small: 10 },
  medium: { body: 12, small: 11 },
  large: { body: 13, small: 12 },
} as const;

export type TipografiStruk = {
  body: string;
  small: string;
  emphasis: string;
  heading: string;
  total: string;
};

/** DIPOR: getReceiptTypography(). */
export function tipografiStruk(kunci: SetelanStruk["receiptFontSize"]): TipografiStruk {
  const f = UKURAN_FONT_STRUK[kunci] ?? UKURAN_FONT_STRUK.large;
  return {
    body: `${f.body}px`,
    small: `${f.small}px`,
    emphasis: `${f.body + 2}px`,
    heading: `${f.small - 1}px`,
    total: `${f.body}px`,
  };
}

/* -------------------------------------------------------------------------
   Data struk
   ---------------------------------------------------------------------- */

export type ItemStruk = {
  name: string;
  variant: string;
  qty: number;
  price: number;
  lineTotal?: number;
  note?: string;
  /** Sama dengan nama item di KOT: varian ikut disebut supaya tidak tertukar. */
  receiptLabel?: string;
};

export type DataStruk = {
  receiptNo: string;
  storeName?: string;
  storeAddress?: string;
  footer?: string;
  receiptWidth?: LebarStruk;
  receiptFontSize?: SetelanStruk["receiptFontSize"];
  receiptMode?: SetelanStruk["receiptMode"];
  payment: string;
  customerName: string;
  chatDate: string;
  queueNo?: number | string | null;
  sendNote: string;
  subtotal: number;
  shipping: number;
  total: number;
  usedDeposit?: number;
  items: ItemStruk[];
};

/* -------------------------------------------------------------------------
   Util
   ---------------------------------------------------------------------- */

/** Format uang yang sama persis dengan app lama: Rp, id-ID, tanpa desimal. */
const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export const formatRupiah = (n: number) => RUPIAH.format(Number(n || 0));

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const n = (v: unknown): number => {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
};

/** DIPOR: normalizeSendNoteText(). Catatan yang cuma berisi "kirim" atau
    "titip" bukan informasi, jadi dibuang supaya tidak memenuhi struk. */
export function normalisasiCatatanKirim(value: unknown): string {
  const s = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;|.-]+|[\s,;|.-]+$/g, "")
    .trim();
  if (/^(?:kirim|dikirim|di kirim|antar|diantar|di antar|dianter|di anter|anter|drop|titip)(?: ke)?$/i.test(s)) {
    return "";
  }
  return s;
}

/** Nama item yang dicetak — sama dengan yang dipakai KOT. */
export function namaItemStruk(item: ItemStruk): string {
  if (item.receiptLabel && item.receiptLabel.trim()) {
    return `${item.name} (${item.receiptLabel.trim()})`;
  }
  return namaItemKot({ name: item.name, variant: item.variant, qty: item.qty, price: item.price });
}

/* -------------------------------------------------------------------------
   Bentuk struk — urutan baris WAJIB sama
   ---------------------------------------------------------------------- */

/**
 * Menghasilkan HTML struk. Mengembalikan string, bukan JSX, supaya yang
 * dicetak ke printer dan yang tampil di pratinjau benar-benar objek yang sama.
 */
export function strukHtml(data: DataStruk, setelan: SetelanStruk = STRUK_DEFAULT): string {
  const lebar = data.receiptWidth ?? setelan.receiptWidth;
  const kompak = (data.receiptMode ?? setelan.receiptMode) === "compact";
  const namaToko = data.storeName || setelan.storeName;
  const alamatToko = data.storeAddress || setelan.storeAddress;
  const footer = data.footer ?? setelan.footer;
  const subtotal = n(data.subtotal);
  const ongkir = n(data.shipping);
  const total = n(data.total);
  const deposit = n(data.usedDeposit);
  const customer = String(data.customerName || "").trim();
  const chatDate = String(data.chatDate || "").trim();
  const catatan = normalisasiCatatanKirim(data.sendNote);
  const antre = data.queueNo === null || data.queueNo === undefined ? "" : String(data.queueNo).trim();

  const header = `
    <header class="receipt-header receipt-center${kompak ? " receipt-compact-header" : ""}">
      <img class="receipt-logo" src="${logoStruk(lebar)}" alt="Logo Shanti Catering">
      <h3 class="receipt-store-name">${escapeHtml(namaToko)}</h3>
      ${kompak ? "" : `<p class="receipt-store-address">${escapeHtml(alamatToko).replace(/\n/g, "<br>")}</p>`}
    </header>`;

  const infoPesanan = [
    customer
      ? `<div class="receipt-info receipt-customer"><strong class="receipt-customer-name">${escapeHtml(customer)}</strong></div>`
      : "",
    antre
      ? `<div class="receipt-info receipt-queue"><strong>NO: ${escapeHtml(antre)}</strong></div>`
      : chatDate
        ? `<div class="receipt-info receipt-chat-date receipt-small">${escapeHtml(chatDate)}</div>`
        : "",
    catatan
      ? `<div class="receipt-info receipt-send-note"><strong class="receipt-send-note-label">CATATAN KIRIM:</strong> <strong class="receipt-send-note-value">${escapeHtml(catatan)}</strong></div>`
      : "",
  ].filter(Boolean).join("");

  const itemHtml = data.items
    .map((item) => {
      const lineTotal = n(item.lineTotal ?? item.price * item.qty);
      const note = String(item.note || "").trim();
      return `
        <div class="receipt-item">
          <div class="receipt-item-name">${escapeHtml(namaItemStruk(item))}</div>
          ${note ? `<div class="receipt-note">Catatan: ${escapeHtml(note)}</div>` : ""}
          <div class="receipt-row receipt-item-pricing receipt-small">
            <span class="receipt-item-unit"><strong class="receipt-quantity">${n(item.qty)}</strong><span> x ${formatRupiah(n(item.price))}</span></span>
            <strong class="receipt-line-total">${formatRupiah(lineTotal)}</strong>
          </div>
        </div>`;
    })
    .join("");

  const barisOngkir = !kompak || ongkir
    ? `<div class="receipt-row receipt-summary-row receipt-shipping"><strong>Ongkir</strong><strong>${formatRupiah(ongkir)}</strong></div>`
    : "";

  const kaki = kompak
    ? ""
    : `<div class="receipt-line"></div><p class="receipt-center">${escapeHtml(footer)}</p>`;

  return `
    ${header}
    ${infoPesanan ? `<div class="receipt-line"></div>${infoPesanan}` : ""}
    <div class="receipt-line"></div>
    ${itemHtml || `<p class="receipt-center">Keranjang kosong</p>`}
    <div class="receipt-line"></div>
    <div class="receipt-row receipt-summary-row"><span>Subtotal</span><strong>${formatRupiah(subtotal)}</strong></div>
    ${barisOngkir}
    ${deposit > 0 ? `<div class="receipt-row receipt-summary-row"><span>Potongan Deposit</span><strong>-${formatRupiah(deposit)}</strong></div>` : ""}
    <div class="receipt-row receipt-summary-row"><span>Pembayaran</span><strong>${escapeHtml(data.payment)}</strong></div>
    <div class="receipt-line"></div>
    <div class="receipt-total receipt-center">
      <strong class="receipt-total-label">TOTAL BAYAR</strong>
      <strong class="receipt-total-value">${formatRupiah(total - deposit)}</strong>
    </div>
    ${kaki}`;
}

/* -------------------------------------------------------------------------
   CSS — disalin dari styles.css supaya hasil cetak tidak berubah
   ---------------------------------------------------------------------- */

export function cssStruk(setelan: SetelanStruk = STRUK_DEFAULT): string {
  const t = tipografiStruk(setelan.receiptFontSize);
  const lebar = setelan.receiptWidth;
  return `
:root {
  --receipt-width: ${lebar}mm;
  --receipt-print-width: ${lebarCetakMm(lebar)}mm;
  --receipt-font-size: ${t.body};
  --receipt-small-font-size: ${t.small};
  --receipt-emphasis-font-size: ${t.emphasis};
  --receipt-heading-font-size: ${t.heading};
  --receipt-total-font-size: ${t.total};
}
* { box-sizing: border-box; }
body { margin: 0; background: #f3f4f6; }
.receipt-paper {
  width: var(--receipt-print-width);
  max-width: 100%;
  min-height: 0;
  margin: 0 auto;
  border: 0;
  border-radius: 0;
  outline: 1px solid #d6d3ce;
  background: #fff;
  color: #111;
  padding: 0.5mm 0.5mm 0 1mm;
  font-family: "Courier New", Courier, monospace;
  font-size: var(--receipt-font-size);
  font-weight: 600;
  font-synthesis: weight;
  line-height: 1.3;
  box-shadow: 0 10px 24px rgba(31, 41, 55, 0.12);
}
.receipt-paper h3, .receipt-paper p { margin: 0; }
.receipt-logo {
  display: block;
  width: min(18mm, 48%);
  height: 18mm;
  margin: 0 auto 2.5mm;
  image-rendering: crisp-edges;
  object-fit: contain;
}
.receipt-header { text-align: center; }
.receipt-store-name { font-size: var(--receipt-heading-font-size); font-weight: 700; line-height: 1.2; }
.receipt-store-address { margin-top: 1mm; font-size: calc(var(--receipt-small-font-size) - 2px); line-height: 1.35; }
.receipt-center { text-align: center; }
.receipt-line { margin: 3.5mm 0; border-top: 0.45mm dashed #111; }
/* Pemisah antar struk saat cetak banyak struk sekaligus.
 *
 * Elemennya sudah disisipkan oleh gabungStruk() (cetak-struk.ts), tapi
 * tanpa aturan ini div-nya kosong tanpa garis — jadi dua struk menempel
 * saling menyambung dan kasir tidak bisa tahu di mana satu struk berakhir dan
 * yang berikutnya mulai. Salinan dari styles.css lama (baris 2359). */
.receipt-batch-separator {
  width: var(--receipt-print-width);
  margin: 2mm 0;
  border-top: 0.45mm dashed #111;
}
.receipt-row { display: flex; justify-content: space-between; gap: 10px; }
.receipt-row span { min-width: 0; overflow-wrap: anywhere; }
.receipt-row strong { flex-shrink: 0; text-align: right; }
.receipt-info { overflow-wrap: anywhere; }
.receipt-customer {
  margin: 1.5mm 0;
  border: 0.65mm solid #111;
  padding: 2mm 1mm;
  text-align: center;
  font-size: var(--receipt-emphasis-font-size);
  font-weight: 900;
  line-height: 1.22;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.receipt-customer-name, .receipt-queue { display: block; }
.receipt-item { margin-bottom: 3mm; break-inside: avoid; page-break-inside: avoid; }
.receipt-item-name { font-weight: 900; line-height: 1.22; overflow-wrap: anywhere; word-break: break-word; }
.receipt-small { font-size: var(--receipt-small-font-size); }
.receipt-send-note {
  margin: 1.5mm 0 0;
  font-size: var(--receipt-font-size);
  font-weight: 900;
  line-height: 1.22;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.receipt-send-note-label, .receipt-send-note-value, .receipt-quantity, .receipt-line-total { font-weight: 900; }
.receipt-note {
  margin-top: 1.2mm;
  color: #333;
  font-size: var(--receipt-small-font-size);
  font-weight: 600;
  line-height: 1.24;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.receipt-item-pricing { margin-top: 1.2mm; align-items: baseline; }
.receipt-item-unit { white-space: nowrap; font-weight: 600; }
.receipt-summary-row { margin: 1.2mm 0; font-weight: 600; }
.receipt-summary-row strong { font-weight: 900; }
.receipt-shipping, .receipt-shipping strong { font-weight: 900; }
.receipt-total { display: grid; gap: 1.3mm; justify-items: center; font-weight: 900; line-height: 1; }
.receipt-total-label, .receipt-total-value { display: block; font-size: var(--receipt-total-font-size); font-weight: 900; line-height: 1; }
.receipt-total-value { white-space: nowrap; }
@media print {
  @page { size: var(--receipt-print-width) auto; margin: 0; }
  body { background: #fff; }
  .receipt-paper { box-shadow: none; outline: none; }
}
`;
}
