/* ==========================================================================
   Itsfood — pure logic for the supplier.itsfood.id scrapers.

   The supplier portal has no JSON API: every endpoint returns server-
   rendered HTML (CodeIgniter + HTMX). This module turns that HTML into
   typed data. It never fetches — network lives in src/server/itsfood-
   server.ts — so every parser is unit-testable against a fixture string.

   Endpoints mirrored here:
     GET  /orders?page=N&filters[delivery_date][start_date]=...   list
     GET  /orders/order/:id                                       detail
     POST /orders/acceptOrder  { order_id, supplier_id, csrf_token }
   ========================================================================== */

export interface ItsfoodOrder {
  id: string;
  /** "Lab. Energi dan Lingkungan ITS" (dari kolom Customer). */
  customer: string;
  /** "2026-10-26" */
  orderedDate: string;
  /** "12:51:39" */
  orderedTime: string;
  /** "2026-10-27" — tanggal yang dipakai kalender. */
  deliveryDate: string;
  /** "11:00:00" */
  deliveryTime: string;
  purpose: string;
  address: string;
  /** "Belum diproses" | "Sedang Diproses" | ... verbatim dari portal. */
  status: string;
  /** Portal hanya merender tombol konfirmasi untuk order "Belum diproses". */
  canAccept: boolean;
}

export interface ItsfoodItem {
  name: string;
  /** "Rp. 44,000" — verbatim, jangan diformat ulang di parser. */
  price: string;
  /** "25" */
  qty: string;
  subtotal: string;
}

export interface ItsfoodOrderDetail {
  id: string;
  pemesan: string;
  unit: string;
  telepon: string;
  email: string;
  alamat: string;
  /** "2026-10-26 12:51:39" */
  waktuPemesanan: string;
  /** "2026-10-27 11:00:00" */
  waktuPengantaran: string;
  tujuan: string;
  /** Biaya order dari portal (jika ada), kosong kalau tidak ada. */
  orderCost: string;
  /** Service charge dari portal (jika ada), kosong kalau tidak ada. */
  serviceCharge: string;
  /** Catatan bebas dari pemesan — sering kosong, itu normal. */
  catatan: string;
  items: ItsfoodItem[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Strip tags + collapse whitespace. Entity refs that appear in the
    portal's Indonesian copy are decoded minimally. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Orders list parser                                                  */
/* ------------------------------------------------------------------ */

/**
 * One <tr> → ItsfoodOrder. Column order (desktop table):
 *   id+status · customer · order date · delivery date · purpose ·
 *   address · status pill · actions
 * Mobile-only label spans ("Customer: ...") are stripped from the value.
 */
export function parseOrderRow(row: string): ItsfoodOrder | null {
  const idMatch = row.match(/\/orders\/order\/(\d+)/);
  if (!idMatch) return null;

  const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? [];
  const text = cells.map(stripTags);

  const pill = row.match(/pill[^>]*>\s*([^<]+?)\s*</);
  const status = pill ? pill[1].trim() : text[6] || "";

  const delivery = splitDate((text[3] ?? "").replace(/^Delivery Date:\s*/, ""));
  const ordered = splitDate((text[2] ?? "").replace(/^Order Date:\s*/, ""));

  return {
    id: idMatch[1],
    customer: (text[1] ?? "").replace(/^Customer:\s*/, ""),
    orderedDate: ordered.date,
    orderedTime: ordered.time,
    deliveryDate: delivery.date,
    deliveryTime: delivery.time,
    purpose: (text[4] ?? "").replace(/^Keperluan:\s*/, ""),
    address: (text[5] ?? "").replace(/^Alamat:\s*/, ""),
    status,
    canAccept: row.includes("confirmOrder"),
  };
}

/** "2026-10-27 11:00:00" → { date, time }. Toleran terhadap tanggal polos. */
export function splitDate(value: string): { date: string; time: string } {
  const parts = value.trim().split(/\s+/);
  return { date: parts[0] ?? "", time: parts.slice(1).join(" ") };
}

/** Full /orders page → orders. Empty body = session died upstream; the
    caller (server layer) owns that distinction, here just "no rows". */
export function parseOrdersPage(html: string): ItsfoodOrder[] {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];
  const rows = tbody[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const out: ItsfoodOrder[] = [];
  for (const row of rows) {
    const order = parseOrderRow(row);
    if (order) out.push(order);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Order detail parser                                                 */
/* ------------------------------------------------------------------ */

/**
 * /orders/order/:id → detail. The first <section> holds the identity
 * fields as <h5>Label:</h5><span>value</span> pairs; the second holds the
 * item table (Menu/Harga/Qty/Subtotal per row).
 */
export function parseOrderDetail(html: string, id: string): ItsfoodOrderDetail | null {
  const sections = html.match(/<section[^>]*>([\s\S]*?)<\/section>/g);
  if (!sections || sections.length === 0) return null;

  const fields = parseLabeledFields(sections[0]);
  const items = sections[1] ? parseItemsSection(sections[1]) : [];

  const ambilField = (...kandidat: string[]): string => {
    for (const k of kandidat) {
      if (fields[k]) return fields[k];
    }
    // fallback: label yang mengandung kata kunci (case-insensitive)
    const keys = Object.keys(fields);
    for (const k of kandidat) {
      const kl = k.toLowerCase();
      const hit = keys.find((kk) => kk.toLowerCase().includes(kl));
      if (hit && fields[hit]) return fields[hit];
    }
    return "";
  };

  return {
    id,
    pemesan: fields["Pemesan"] ?? "",
    unit: fields["Unit"] ?? "",
    telepon: fields["No Telp"] ?? "",
    email: fields["Email"] ?? "",
    alamat: fields["Alamat Pengiriman"] ?? "",
    waktuPemesanan: fields["Waktu Pemesanan"] ?? "",
    waktuPengantaran: fields["Waktu Pengantaran"] ?? "",
    tujuan: fields["Tujuan Pemesanan"] ?? "",
    orderCost: ambilField("Order Cost", "Biaya Order", "Total Order", "Order Amount", "Cost"),
    serviceCharge: ambilField("Service Charge", "Biaya Layanan", "Biaya Jasa", "Service Fee", "Charge"),
    catatan: fields["Catatan"] ?? "",
    items,
  };
}

/** "Label:" → value pairs from <h5>/<label>-ish tags followed by <span>. */
function parseLabeledFields(section: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pairs = section.matchAll(
    /<h[45][^>]*>\s*([^<]+?)\s*<\/h[45]>\s*<span[^>]*>([\s\S]*?)<\/span>/g,
  );
  for (const pair of pairs) {
    const label = stripTags(pair[1]).replace(/:\s*$/, "");
    if (label) out[label] = stripTags(pair[2]);
  }
  return out;
}

/**
 * Item rows: one <tr> per menu, each cell repeating its label in a
 * mobile-only div ("Menu:", "Harga:", ...). The Subtotal cell holds two
 * amounts (Price + COGS); the dashboard wants the Price one.
 */
function parseItemsSection(section: string): ItsfoodItem[] {
  const rows = section.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const items: ItsfoodItem[] = [];
  for (const row of rows) {
    if (!row.includes("Menu:")) continue; // header row, not an item
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
    const cell = (i: number) =>
      stripTags((tds[i] ?? "").replace(/<div class="lg:hidden[^>]*>[^<]*<\/div>/, ""));
    items.push({
      name: cell(0),
      price: cell(1),
      qty: cell(3),
      // Subtotal cell = "Price: X COGS: Y" → ambil amount pertama.
      subtotal: (cell(4).match(/Rp\.?\s*[\d.,]+/) ?? [cell(4)])[0],
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Payments — billables / bills / history                              */
/* ------------------------------------------------------------------ */

export interface ItsfoodBillable {
  orderId: string;
  customer: string;
  deliveryDate: string;
  purpose: string;
  /** Verbatim, mis. "Rp. 1,770,000". */
  amount: string;
  amountValue: number;
}

export interface ItsfoodBill {
  billId: string;
  orderId: string;
  createdAt: string;
  processDate: string;
  paidDate: string;
  receivable: string;
  receivableValue: number;
  /** "pending" | ... verbatim dari portal. */
  status: string;
}

export interface ItsfoodPaymentHistory {
  id: string;
  processDate: string;
  paidDate: string;
  total: string;
  totalValue: number;
  bank: string;
  orderIds: string[];
}

/** "Rp. 1,770,000" → 1770000. Portal memakai koma sebagai pemisah ribuan
    dan nominal rupiah utuh (tanpa desimal) — pemisah non-digit dibuang. */
export function parseRupiah(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

/** `<tbody>` → array of cell-text arrays, dari markup responsif portal:
    tiap <td> punya label mobile ("Amount:") yang dibuang dulu supaya
    tidak menempel di nilai. */
function rowsFromTbody(html: string): string[][] {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];
  const rows = tbody[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const out: string[][] = [];
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? [];
    out.push(
      cells.map((c) =>
        stripTags(
          c
            // buang label mobile (div/span dengan class lg:hidden), termasuk
            // yang isinya bukan teks polos (mis. "#" pada kolom ID)
            .replace(/<(div|span)\b[^>]*\blg:hidden\b[^>]*>[\s\S]*?<\/\1>/g, "")
            .replace(/<div class="lg:hidden[^>]*>[^<]*<\/div>/g, ""),
        ),
      ),
    );
  }
  return out;
}

export function parseBillablesPage(html: string): ItsfoodBillable[] {
  return rowsFromTbody(html)
    .map((cells) => {
      const orderId = cells[0]?.match(/(?:Order Id:\s*)?(\d{5,})/)?.[1];
      if (!orderId) return null;
      const amount = cells[4] ?? "";
      return {
        orderId,
        customer: (cells[1] ?? "").replace(/^Customer:\s*/, ""),
        deliveryDate: (cells[2] ?? "").replace(/^Delivery Date:\s*/, ""),
        purpose: (cells[3] ?? "").replace(/^Order Purpose:\s*/, ""),
        amount,
        amountValue: parseRupiah(amount),
      };
    })
    .filter((x): x is ItsfoodBillable => x !== null);
}

export function parseBillsPage(html: string): ItsfoodBill[] {
  return rowsFromTbody(html)
    .map((cells) => {
      const billId = (cells[0] ?? "").replace(/^Bill ID:\s*/, "");
      if (!/^\d+$/.test(billId)) return null;
      const receivable = cells[5] ?? "";
      return {
        billId,
        orderId: (cells[1] ?? "").replace(/^Order ID:\s*/, ""),
        createdAt: (cells[2] ?? "").replace(/^Created At:\s*/, ""),
        processDate: (cells[3] ?? "").replace(/^Process Date:\s*/, ""),
        paidDate: (cells[4] ?? "").replace(/^Paid Date:\s*/, ""),
        receivable,
        receivableValue: parseRupiah(receivable),
        status: (cells[6] ?? "").replace(/^Status:\s*/, ""),
      };
    })
    .filter((x): x is ItsfoodBill => x !== null);
}

export function parseHistoryPage(html: string): ItsfoodPaymentHistory[] {
  return rowsFromTbody(html)
    .map((cells) => {
      const id = (cells[0] ?? "").replace(/^Id:\s*/, "");
      if (!/^\d+$/.test(id)) return null;
      const total = cells[3] ?? "";
      const ids = (cells[6] ?? "").replace(/^Order Ids?:?\s*/, "");
      return {
        id,
        processDate: (cells[1] ?? "").replace(/^Process Date:\s*/, ""),
        paidDate: (cells[2] ?? "").replace(/^Paid Date:\s*/, ""),
        total,
        totalValue: parseRupiah(total),
        bank: (cells[4] ?? "").replace(/^Bank:\s*/, ""),
        orderIds: ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    })
    .filter((x): x is ItsfoodPaymentHistory => x !== null);
}

/* ------------------------------------------------------------------ */
/* Rekap pembayaran                                                    */
/* ------------------------------------------------------------------ */

export interface RekapPembayaran {
  omzet: number;
  bisaDitagih: number;
  /** Tagihan di tab Tagihan yang belum masuk rekening Shanti. */
  belumTerbayar: number;
  sudahDibayar: number;
}

export interface PetaBayarOrder {
  /** Order yang sudah masuk daftar "Bisa Ditagih". */
  bisaDitagih: Set<string>;
  /** Order punya tagihan berjalan (belum dibayar). */
  tagihanPending: Map<string, ItsfoodBill>;
  /** Order yang pembayarannya sudah masuk history. */
  terbayar: Set<string>;
}

/** Order IDs whose payment already entered the history list — the basis
    for "money has arrived at Shanti's account". Shared by the payment map
    and the bill filters so every consumer applies the same rule. */
function terbayarDari(history: ItsfoodPaymentHistory[]): Set<string> {
  return new Set(history.flatMap((h) => h.orderIds));
}

export function petaBayarDari(
  billables: ItsfoodBillable[],
  bills: ItsfoodBill[],
  history: ItsfoodPaymentHistory[],
): PetaBayarOrder {
  return {
    bisaDitagih: new Set(billables.map((b) => b.orderId)),
    tagihanPending: new Map(bills.map((b) => [b.orderId, b])),
    terbayar: terbayarDari(history),
  };
}

/** Status pembayaran satu order — urutan prioritas: terbayar > pending >
    bisa ditagih > belum masuk alur. */
export function statusBayarOrder(
  orderId: string,
  peta: PetaBayarOrder,
): "terbayar" | "pending" | "bisa-ditagih" | "belum-bisa" {
  if (peta.terbayar.has(orderId)) return "terbayar";
  if (peta.tagihanPending.has(orderId)) return "pending";
  if (peta.bisaDitagih.has(orderId)) return "bisa-ditagih";
  return "belum-bisa";
}

export function rekapPembayaranDari(
  billables: ItsfoodBillable[],
  bills: ItsfoodBill[],
  history: ItsfoodPaymentHistory[],
): RekapPembayaran {
  const bisaDitagih = billables.reduce((a, b) => a + b.amountValue, 0);
  // "Belum Terbayar" = tagihan yang uangnya BELUM masuk rekening Shanti.
  // Cancelled/rejected tidak dihitung (bukan piutang riil). Bill yang
  // order-nya sudah masuk payment history juga dibuang — portal tetap
  // menampilkan barisnya setelah uang masuk, dan menghitungnya di sini
  // berarti dobel hitung dengan sudahDibayar. Selaras dengan tab Tagihan.
  const terbayar = terbayarDari(history);
  const belumTerbayar = bills
    .filter((b) => !/cancel|reject/i.test(b.status) && !terbayar.has(b.orderId))
    .reduce((a, b) => a + b.receivableValue, 0);
  const sudahDibayar = history.reduce((a, h) => a + h.totalValue, 0);
  return {
    omzet: bisaDitagih + belumTerbayar + sudahDibayar,
    bisaDitagih,
    belumTerbayar,
    sudahDibayar,
  };
}

/* ------------------------------------------------------------------ */
/* Rekap per periode (hari / 7 hari / bulan)                           */
/* ------------------------------------------------------------------ */

export type PeriodeRekap = "hari" | "7hari" | "bulan";

export const LABEL_PERIODE_REKAP: Record<PeriodeRekap, string> = {
  hari: "Hari ini",
  "7hari": "7 hari",
  bulan: "Bulan ini",
};

export function isoDari(x: Date): string {
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** "2026-10-16 16:55:00" / "2026-10-25" → apakah tanggalnya dalam periode?
    Semua perbandingan string ISO — tidak ada parsing Date yang bisa
    kepeleset zona waktu. */
export function dalamPeriodeIso(
  tanggal: string,
  periode: PeriodeRekap,
  hariIniIso: string,
): boolean {
  if (!tanggal) return false;
  const t = tanggal.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  if (periode === "hari") return t === hariIniIso;
  if (periode === "bulan") return t.slice(0, 7) === hariIniIso.slice(0, 7);
  const dari = new Date(hariIniIso);
  dari.setDate(dari.getDate() - 6);
  return t >= isoDari(dari) && t <= hariIniIso;
}

/** Sumbangan ketiga keranjang untuk satu rentang tanggal (inklusif). */
export function listsRentangDari(
  billables: ItsfoodBillable[],
  bills: ItsfoodBill[],
  history: ItsfoodPaymentHistory[],
  dariIso: string,
  sampaiIso: string,
): {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
} {
  const dalamRentang = (tanggal: string) => {
    const x = tanggal.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= dariIso && x <= sampaiIso;
  };
  // Bill yang order-nya sudah masuk payment history dibuang: uangnya sudah
  // masuk rekening Shanti, jadi bukan lagi piutang berjalan (portal tetap
  // menampilkan barisnya). Tab Tagihan dan rekap otomatis selaras karena
  // keduanya lewat fungsi ini.
  const terbayar = terbayarDari(history);
  return {
    billables: billables.filter((x) => dalamRentang(x.deliveryDate)),
    bills: bills.filter(
      (x) => dalamRentang(x.createdAt) && !terbayar.has(x.orderId),
    ),
    history: history.filter((x) => dalamRentang(x.paidDate)),
  };
}

export function rekapRentangDari(
  billables: ItsfoodBillable[],
  bills: ItsfoodBill[],
  history: ItsfoodPaymentHistory[],
  dariIso: string,
  sampaiIso: string,
): RekapPembayaran & { nBillables: number; nBelumTerbayar: number; nHistory: number } {
  const { billables: b, bills: l, history: h } = listsRentangDari(
    billables,
    bills,
    history,
    dariIso,
    sampaiIso,
  );
  const bisaDitagih = b.reduce((a, x) => a + x.amountValue, 0);
  const sudahDibayar = h.reduce((a, x) => a + x.totalValue, 0);
  // "Belum Terbayar" = semua bill di rentang (kecuali cancelled/rejected),
  // selaras dengan tab Tagihan. Tidak difilter status/terbayar, supaya
  // total kartu sama dengan total tab.
  const belumTerbayarBills = l.filter((x) => !/cancel|reject/i.test(x.status));
  const belumTerbayar = belumTerbayarBills.reduce((a, x) => a + x.receivableValue, 0);
  return {
    omzet: bisaDitagih + belumTerbayar + sudahDibayar,
    bisaDitagih,
    belumTerbayar,
    sudahDibayar,
    nBillables: b.length,
    nBelumTerbayar: belumTerbayarBills.length,
    nHistory: h.length,
  };
}

/** Sumbangan ketiga keranjang untuk satu periode + jumlah itemnya. */
export function rekapPeriodeDari(
  billables: ItsfoodBillable[],
  bills: ItsfoodBill[],
  history: ItsfoodPaymentHistory[],
  periode: PeriodeRekap,
  hariIniIso: string,
): RekapPembayaran & { nBillables: number; nBelumTerbayar: number; nHistory: number } {
  const dari = new Date(hariIniIso);
  if (periode === "7hari") dari.setDate(dari.getDate() - 6);
  if (periode === "bulan") dari.setDate(1);
  return rekapRentangDari(billables, bills, history, isoDari(dari), hariIniIso);
}

/** Omzet periode ini vs periode sebelumnya (sepanjang periode yang sama)
    — bahan pill delta di KPI card. */
export function omzetDuaPeriodeDari(
  billables: ItsfoodBillable[],
  bills: ItsfoodBill[],
  history: ItsfoodPaymentHistory[],
  periode: PeriodeRekap,
  hariIniIso: string,
): { kini: number; lalu: number } {
  const sum = (p: PeriodeRekap, anchor: string) => {
    const f = (t: string) => dalamPeriodeIso(t, p, anchor);
    return (
      billables.filter((x) => f(x.deliveryDate)).reduce((a, x) => a + x.amountValue, 0) +
      bills.filter((x) => f(x.createdAt)).reduce((a, x) => a + x.receivableValue, 0) +
      history.filter((x) => f(x.paidDate)).reduce((a, x) => a + x.totalValue, 0)
    );
  };
  // Anchor periode lalu = ujung dari jendela sebelumnya.
  const hari = new Date(hariIniIso);
  const geser = periode === "hari" ? 1 : periode === "7hari" ? 7 : 0;
  let anchorLalu: string;
  if (periode === "bulan") {
    const lalu = new Date(hari.getFullYear(), hari.getMonth() - 1, 1);
    anchorLalu = isoDari(new Date(lalu.getFullYear(), lalu.getMonth() + 1, 0));
  } else {
    hari.setDate(hari.getDate() - geser);
    anchorLalu = isoDari(hari);
  }
  return { kini: sum(periode, hariIniIso), lalu: sum(periode, anchorLalu) };
}

const BULAN_SINGKAT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** "2026-10-26 10:55:17" → "26 Okt 2026 · 10:55". ISO mentah di UI itu
    beban baca; portal memang menulis ISO, terjemahan terjadi di tampilan. */
export function tanggalJamPendek(t: string): string {
  const [tgl, jam] = t.split(" ");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl ?? "")) return t;
  const [y, m, d] = tgl.split("-").map(Number);
  const dasar = `${Number(d)} ${BULAN_SINGKAT[m - 1]} ${y}`;
  return jam ? `${dasar} · ${jam.slice(0, 5)}` : dasar;
}

/** "2026-10-16 16:55:00" → "16 Okt 2026". */
export function tanggalPendekItsfood(t: string): string {
  return tanggalJamPendek(t).split(" · ")[0];
}

/* ------------------------------------------------------------------ */
/* Detail satu pembayaran (/payments/payment/:id)                      */
/* ------------------------------------------------------------------ */

export interface ItsfoodBillBaris {
  billId: string;
  orderId: string;
  deliveryDate: string;
  payable: string;
  payableValue: number;
  billedAt: string;
}

export interface ItsfoodPaymentDetail {
  id: string;
  processDate: string;
  createdAt: string;
  total: string;
  totalValue: number;
  paidDate: string;
  bank: string;
  /** Rincian per order di dalam pembayaran itu. */
  bills: ItsfoodBillBaris[];
}

/** Halaman detail pembayaran: <section> pertama = field identitas
    (h5 Label: + span value, pola yang sama dengan detail order),
    tbody = tabel bills per order. */
export function parsePaymentDetail(html: string, id: string): ItsfoodPaymentDetail | null {
  const sections = html.match(/<section[^>]*>([\s\S]*?)<\/section>/g);
  if (!sections || sections.length === 0) return null;
  const fields = parseLabeledFields(sections[0]);
  const bills = rowsFromTbody(html)
    .map((c) => {
      const billId = (c[0] ?? "").replace(/^Bill Id:\s*/i, "");
      if (!/^\d+$/.test(billId)) return null;
      const payable = c[3] ?? "";
      return {
        billId,
        orderId: (c[1] ?? "").replace(/^Order Id:\s*/i, ""),
        deliveryDate: (c[2] ?? "").replace(/^Delivery Date:\s*/i, ""),
        payable,
        payableValue: parseRupiah(payable),
        billedAt: (c[4] ?? "").replace(/^Billed At:\s*/i, ""),
      };
    })
    .filter((x): x is ItsfoodBillBaris => x !== null);
  const total = fields["Total Amount"] ?? "";
  return {
    id,
    processDate: fields["Process Date"] ?? "",
    createdAt: fields["Created At"] ?? "",
    total,
    totalValue: parseRupiah(total),
    paidDate: fields["Paid Date"] ?? "",
    bank: fields["Bank"] ?? "",
    bills,
  };
}

/** Nomor telepon portal → link wa.me. Format portal macam-macam
    ("081336663713", "+62813…", dengan spasi/strip) — dibersihkan jadi
    digit, prefix lokal 0 → 62. Return null kalau tidak masuk akal. */
export function linkWa(no: string): string | null {
  const digits = no.replace(/\D/g, "");
  if (!digits) return null;
  const internasional = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  if (internasional.length < 9 || internasional.length > 15) return null;
  return `https://wa.me/${internasional}`;
}

/* ------------------------------------------------------------------ */
/* Products — list + detail                                            */
/* ------------------------------------------------------------------ */

export interface ItsfoodProduct {
  id: string;
  name: string;
  category: string;
  price: string;
  cogs: string;
  status: string;
  createdAt: string;
}

export interface ItsfoodProductDetail {
  id: string;
  name: string;
  supplier: string;
  category: string;
  status: string;
  description: string;
  createdAt: string;
  price: string;
  cogs: string;
  minOrder: string;
  maxOrder: string;
  preOrderDays: string;
  preOrderHours: string;
  tags: string;
}

/** /products page → array of products. Columns: ID, Name, Category,
    Price, COGS, Status, Created At. Filter rows where id matches /^\d+$/. */
export function parseProductsPage(html: string): ItsfoodProduct[] {
  return rowsFromTbody(html)
    .map((cells) => {
      const id = (cells[0] ?? "").match(/(\d+)/)?.[1] ?? "";
      if (!id) return null;
      return {
        id,
        name: (cells[1] ?? "").replace(/^(Nama|Name):\s*/i, "").trim(),
        category: (cells[2] ?? "").replace(/^(Kategori|Category):\s*/i, "").trim(),
        price: (cells[3] ?? "").replace(/^(Harga|Price):\s*/i, "").trim(),
        cogs: (cells[4] ?? "").replace(/^(COGS|HPP):\s*/i, "").trim(),
        status: (cells[5] ?? "").replace(/^(Status):\s*/i, "").trim(),
        createdAt: (cells[6] ?? "").replace(/^(Created At|Dibuat):\s*/i, "").trim(),
      };
    })
    .filter((x): x is ItsfoodProduct => x !== null);
}

/** /products/product/:id → detail. Uses parseLabeledFields on the first
    section. Field labels mapped to canonical keys. */
export function parseProductDetail(html: string, id: string): ItsfoodProductDetail | null {
  const sections = html.match(/<section[^>]*>([\s\S]*?)<\/section>/g);
  if (!sections || sections.length === 0) return null;
  const fields = parseLabeledFields(sections[0]);
  return {
    id,
    name: fields["Nama"] ?? "",
    supplier: fields["Supplier"] ?? "",
    category: fields["Kategori"] ?? "",
    status: fields["Status"] ?? "",
    description: fields["Description"] ?? "",
    createdAt: fields["Created at"] ?? "",
    price: fields["Harga"] ?? "",
    cogs: fields["COGS"] ?? "",
    minOrder: fields["Min Order"] ?? "",
    maxOrder: fields["Max Order"] ?? "",
    preOrderDays: fields["Pre Order Days"] ?? "",
    preOrderHours: fields["Pre Order Hours"] ?? "",
    tags: fields["Tags"] ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Teks ringkasan order untuk WhatsApp                                 */
/* ------------------------------------------------------------------ */

/** Format WA: *teks* = bold. Isi sesuai yang dibutuhkan penerima
    (kurir/dapur): alamat, jam antar, item, catatan — bukan semua field.
    Emoji secukupnya sebagai penanda baris, bukan hiasan. */
export function ringkasanWa(
  order: Pick<ItsfoodOrder, "id" | "deliveryDate" | "deliveryTime" | "address">,
  detail?: ItsfoodOrderDetail | null,
): string {
  const alamat = detail?.alamat?.trim() || order.address;
  const pemesan = detail?.pemesan?.trim();
  const telepon = detail?.telepon?.trim();
  const baris: string[] = [`*📦 Order #${order.id}*`];
  if (pemesan) baris.push(`👤 Pemesan: ${pemesan}`);
  // Jam & tanggal antar dibold — itu data yang paling dicari di chat.
  baris.push(`🛵 Antar: *${tanggalPendekItsfood(order.deliveryDate)} ${order.deliveryTime}*`);
  if (telepon) baris.push(`📞 No: ${telepon}`);
  baris.push(`📍 Alamat: ${alamat}`);

  if (detail && detail.items.length > 0) {
    baris.push("", "🍽 *Pesanan:*");
    for (const it of detail.items) {
      baris.push(`• ${it.qty}x ${bersihkanNamaItemWa(it.name)} — ${it.subtotal}`);
    }
  } else {
    baris.push("", "Pesanan: (rincian belum termuat)");
  }

  const catatan = detail?.catatan?.trim();
  if (catatan) baris.push("", `📝 Catatan: ${catatan}`);
  return baris.join("\n");
}

/** Nama item versi teks WA: suffix brand juga dibuang, dan tanda yang
    bentrok format WA (* _ ~) dilucuti dari nama item. */
function bersihkanNamaItemWa(name: string): string {
  return name.replace(/\s*-\s*Shanti Catering\s*$/i, "").replace(/[*_~]/g, "");
}

/** Status tagihan portal → label & warna yang bisa dibaca manusia.
    Portal mengirim bahasa mesinnya ("pending", "processed", ...); UI tidak
    menelan mentah. Pencocokan pakai includes supaya varian ejaan portal
    ("process"/"processing"/"processed") jatuh ke label yang sama. */
export function labelStatusBill(
  status: string,
): { label: string; tone: "success" | "warning" | "neutral" } {
  const s = status.toLowerCase();
  if (s.includes("paid")) return { label: "Lunas di Itsfood", tone: "success" };
  if (s.includes("process")) return { label: "Diverifikasi", tone: "neutral" };
  if (s.includes("pending")) return { label: "Belum Bayar", tone: "warning" };
  if (s.includes("cancel") || s.includes("reject"))
    return { label: "Dibatalkan", tone: "neutral" };
  return { label: status, tone: "neutral" };
}

/** Deret omzet harian nHari terakhir (untuk chart tren). Bucket sama
    dengan rekap: billables→delivery, bills→created, history→paid. */
export function trenOmzetHarian(
  billables: ItsfoodBillable[],
  bills: ItsfoodBill[],
  history: ItsfoodPaymentHistory[],
  hariIniIso: string,
  nHari: number,
): { d: string; tanggal: string; omzet: number }[] {
  const perTanggal = new Map<string, number>();
  const tambah = (t: string, v: number) => {
    if (!t) return;
    const k = t.slice(0, 10);
    perTanggal.set(k, (perTanggal.get(k) ?? 0) + v);
  };
  const terbayar = terbayarDari(history);
  for (const b of billables) tambah(b.deliveryDate, b.amountValue);
  // Bill yang order-nya sudah di history tidak dihitung lagi di sini —
  // uang yang sama sudah dihitung dari bucket history pada paidDate-nya.
  for (const b of bills) {
    if (!terbayar.has(b.orderId)) tambah(b.createdAt, b.receivableValue);
  }
  for (const h of history) tambah(h.paidDate, h.totalValue);

  const hari = new Date(hariIniIso);
  const out: { d: string; tanggal: string; omzet: number }[] = [];
  for (let i = nHari - 1; i >= 0; i--) {
    const d = new Date(hari.getFullYear(), hari.getMonth(), hari.getDate() - i);
    const k = isoDari(d);
    out.push({
      d: `${d.getDate()} ${BULAN_SINGKAT[d.getMonth()]}`,
      tanggal: k,
      omzet: perTanggal.get(k) ?? 0,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Status mapping                                                      */
/* ------------------------------------------------------------------ */

/** Portal status → Pill tone, per DESIGN.md (mint = success, amber = pending). */
export function statusItsfoodTone(
  status: string,
): "success" | "warning" | "neutral" {
  const s = status.toLowerCase();
  if (s.includes("belum")) return "warning";
  if (s.includes("sedang") || s.includes("selesai")) return "success";
  return "neutral";
}

/** Dots on the calendar: pending days must stand out (amber), days with
    only processed orders stay quiet (mint). */
export function ringkasHariKalender(
  orders: ItsfoodOrder[],
): { pending: number; total: number } {
  return {
    pending: orders.filter((o) => o.canAccept).length,
    total: orders.length,
  };
}
