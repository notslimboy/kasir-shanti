import { describe, expect, it } from "vitest";

import {
  linkWa,
  labelStatusBill,
  ringkasanWa,
  parseBillablesPage,
  parseBillsPage,
  parseHistoryPage,
  parseOrderDetail,
  parseOrderRow,
  parseOrdersPage,
  parsePaymentDetail,
  parseRupiah,
  petaBayarDari,
  rekapPembayaranDari,
  splitDate,
  statusBayarOrder,
  statusItsfoodTone,
  stripTags,
  tanggalJamPendek,
  tanggalPendekItsfood,
} from "./itsfood";

/* Fixtures mimic the portal's real markup (CodeIgniter + DaisyUI +
   responsive label divs) without copying any real customer data. */

const ROW_PENDING = `
<tr class="block lg:table-row">
  <td class="grid grid-cols-2 lg:table-cell p-2">
    <div class="lg:hidden text-sm font-bold text-gray-500">Id:</div>
    <div class="text-right lg:text-left">
      <a href="https://supplier.itsfood.id/orders/order/183712"># 183712</a>
      <span class="pill bg-red-300">Belum diproses</span>
    </div>
  </td>
  <td class="grid grid-cols-2 lg:table-cell p-2">
    <div class="lg:hidden text-sm font-bold text-gray-500">Customer:</div>
    <div class="text-right lg:text-left">Lab Energi BPPU Lab Energi</div>
  </td>
  <td class="grid grid-cols-2 lg:table-cell p-2">
    <div class="lg:hidden text-sm font-bold text-gray-500">Order Date:</div>
    <div class="text-right lg:text-left">
      <span>2026-10-26</span> <br><span class="text-gray-500">12:51:39</span>
    </div>
  </td>
  <td class="grid grid-cols-2 lg:table-cell p-2">
    <div class="lg:hidden text-sm font-bold text-gray-500">Delivery Date:</div>
    <div class="text-right lg:text-left">
      <span>2026-10-27</span> <br><span class="text-gray-500">11:00:00</span>
    </div>
  </td>
  <td class="grid grid-cols-2 lg:table-cell p-2">
    <div class="lg:hidden text-sm font-bold text-gray-500">Keperluan:</div>
    <div class="text-right lg:text-left">Rapat Koordinasi</div>
  </td>
  <td class="grid grid-cols-2 lg:table-cell p-2">
    <div class="lg:hidden text-sm font-bold text-gray-500">Alamat:</div>
    <div class="text-right lg:text-left">Gedung Contoh Lt. 2</div>
  </td>
  <td class="hidden lg:table-cell p-2">
    <span class="bg-blue-300 pill">Belum diproses</span>
  </td>
  <td class="block lg:table-cell text-right lg:text-center">
    <a href="https://supplier.itsfood.id/orders/order/183712">detail</a>
    <span hx-get="https://supplier.itsfood.id/orders/confirmOrder?order_id=183712">confirm</span>
  </td>
</tr>`;

const ROW_PROCESSED = ROW_PENDING
  .replace(/183712/g, "183598")
  .replace(/Lab Energi BPPU Lab Energi/g, "Arsitektur Arsitektur")
  .replace(/2026-10-26/g, "2026-10-20")
  .replace(/2026-10-27/g, "2026-10-24")
  .replace(/Rapat Koordinasi/g, "SENTA 2026")
  .replace(/Gedung Contoh Lt\. 2/g, "AULA BG MUNAF")
  .replace(/confirmOrder\?order_id=183598/g, "about:blank")
  .replace(/bg-red-300/g, "bg-blue-300")
  .replace(/Belum diproses/g, "Sedang Diproses");

describe("stripTags", () => {
  it("melepas tag dan merapikan spasi", () => {
    expect(stripTags("<div>  a </div> <span>b</span>")).toBe("a b");
  });

  it("decode entity yang muncul di copy portal", () => {
    expect(stripTags("Rapat &amp; Koordinasi")).toBe("Rapat & Koordinasi");
  });
});

describe("splitDate", () => {
  it("pisah tanggal dan jam", () => {
    expect(splitDate("2026-10-27 11:00:00")).toEqual({
      date: "2026-10-27",
      time: "11:00:00",
    });
  });

  it("tanggal polos tanpa jam", () => {
    expect(splitDate("2026-10-27")).toEqual({ date: "2026-10-27", time: "" });
  });
});

describe("parseOrderRow", () => {
  it("ekstrak semua kolom dari satu baris", () => {
    const o = parseOrderRow(ROW_PENDING);
    expect(o).toEqual({
      id: "183712",
      customer: "Lab Energi BPPU Lab Energi",
      orderedDate: "2026-10-26",
      orderedTime: "12:51:39",
      deliveryDate: "2026-10-27",
      deliveryTime: "11:00:00",
      purpose: "Rapat Koordinasi",
      address: "Gedung Contoh Lt. 2",
      status: "Belum diproses",
      canAccept: true,
    });
  });

  it("order yang sudah diproses tidak bisa diterima", () => {
    const o = parseOrderRow(ROW_PROCESSED);
    expect(o?.status).toBe("Sedang Diproses");
    expect(o?.canAccept).toBe(false);
  });

  it("baris tanpa link order ditolak (null)", () => {
    expect(parseOrderRow("<tr><td>pengantar</td></tr>")).toBeNull();
  });
});

describe("parseOrdersPage", () => {
  it("baca semua baris tbody, urut sesuai halaman", () => {
    const html = `<table><tbody>${ROW_PENDING}${ROW_PROCESSED}</tbody></table>`;
    const orders = parseOrdersPage(html);
    expect(orders.map((o) => o.id)).toEqual(["183712", "183598"]);
  });

  it("halaman tanpa tbody (session mati / redirect) = kosong", () => {
    expect(parseOrdersPage("<html><body></body></html>")).toEqual([]);
  });
});

const DETAIL_HTML = `
<section class="mb-4">
  <ul>
    <li><h5 class="font-bold text-sm text-gray-500">Pemesan:</h5><span>Lab Energi ITS</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Unit:</h5><span>BPPU</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">No Telp:</h5><span>081200000000</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Email:</h5><span>lab@example.ac.id</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Alamat Pengiriman:</h5><span>Gedung Contoh Lt. 5</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Waktu Pemesanan:</h5><span>2026-10-26 12:51:39</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Waktu Pengantaran:</h5><span>2026-10-27 11:00:00</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Tujuan Pemesanan:</h5><span>Asesmen KAN</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Catatan:</h5><span>Tolong jam 11 tepat</span></li>
  </ul>
</section>
<section class="mb-4">
  <table class="table">
    <thead><tr><th>Menu</th><th>Harga</th><th>COGS</th><th>Qty</th><th>Subtotal</th></tr></thead>
    <tbody>
      <tr class="block lg:table-row">
        <td class="grid grid-cols-2 lg:table-cell">
          <div class="lg:hidden text-sm font-bold text-gray-500">Menu:</div>
          <div class="text-right lg:text-left"><span>Paket Gubuk</span></div>
        </td>
        <td class="grid grid-cols-2 lg:table-cell">
          <div class="lg:hidden text-sm font-bold text-gray-500">Harga:</div>
          <div class="text-right lg:text-left">Rp. 44,000</div>
        </td>
        <td class="grid grid-cols-2 lg:table-cell">
          <div class="lg:hidden text-sm font-bold text-gray-500">COGS:</div>
          <div class="text-right lg:text-left">Rp. 39,600</div>
        </td>
        <td class="grid grid-cols-2 lg:table-cell">
          <div class="lg:hidden text-sm font-bold text-gray-500">Qty:</div>
          <div class="text-right lg:text-left">25</div>
        </td>
        <td class="grid grid-cols-2 lg:table-cell">
          <div class="lg:hidden text-sm font-bold text-gray-500">Subtotal:</div>
          <div class="text-right lg:text-left">
            <h6 class="text-gray-500 text-xs">Price: </h6><span>Rp. 1,100,000</span><br>
            <h6 class="text-gray-500 text-xs">COGS:</h6><span>Rp. 990,000</span>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</section>`;

describe("parseOrderDetail", () => {
  it("baca field identitas termasuk catatan", () => {
    const d = parseOrderDetail(DETAIL_HTML, "183712");
    expect(d?.pemesan).toBe("Lab Energi ITS");
    expect(d?.unit).toBe("BPPU");
    expect(d?.telepon).toBe("081200000000");
    expect(d?.email).toBe("lab@example.ac.id");
    expect(d?.alamat).toBe("Gedung Contoh Lt. 5");
    expect(d?.waktuPengantaran).toBe("2026-10-27 11:00:00");
    expect(d?.tujuan).toBe("Asesmen KAN");
    expect(d?.catatan).toBe("Tolong jam 11 tepat");
  });

  it("baca item: nama, harga, qty, subtotal (Price, bukan COGS)", () => {
    const d = parseOrderDetail(DETAIL_HTML, "183712");
    expect(d?.items).toEqual([
      {
        name: "Paket Gubuk",
        price: "Rp. 44,000",
        qty: "25",
        subtotal: "Rp. 1,100,000",
      },
    ]);
  });

  it("catatan kosong tetap string kosong, bukan error", () => {
    const html = DETAIL_HTML.replace("Tolong jam 11 tepat", "");
    expect(parseOrderDetail(html, "183712")?.catatan).toBe("");
  });

  it("halaman error tanpa section = null", () => {
    expect(parseOrderDetail("<html></html>", "1")).toBeNull();
  });
});

describe("statusItsfoodTone", () => {
  it("Belum diproses = warning (amber)", () => {
    expect(statusItsfoodTone("Belum diproses")).toBe("warning");
  });

  it("Sedang Diproses = success (mint)", () => {
    expect(statusItsfoodTone("Sedang Diproses")).toBe("success");
  });

  it("status tak dikenal = neutral", () => {
    expect(statusItsfoodTone("Dibatalkan")).toBe("neutral");
  });
});

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

const BILLABLE_HTML = `
<table><thead><tr><th>Order Id</th><th>Customer</th><th>Delivery Date</th>
<th>Order Purpose</th><th>Amount</th></tr></thead>
<tbody>
<tr>
  <td><a href="https://supplier.itsfood.id/orders/order/183420">183420</a></td>
  <td><div class="lg:hidden">Customer:</div><div>Departemen Contoh Contoh</div></td>
  <td><div class="lg:hidden">Delivery Date:</div><div><span>2026-10-25</span></div></td>
  <td><div class="lg:hidden">Order Purpose:</div><div>Rapat Anggaran</div></td>
  <td><div class="lg:hidden">Amount:</div><div>Rp. 1,770,000</div></td>
</tr>
<tr>
  <td><a href="https://supplier.itsfood.id/orders/order/183441">183441</a></td>
  <td><div class="lg:hidden">Customer:</div><div>Lab Contoh</div></td>
  <td><div class="lg:hidden">Delivery Date:</div><div><span>2026-10-26</span></div></td>
  <td><div class="lg:hidden">Order Purpose:</div><div>Seminar</div></td>
  <td><div class="lg:hidden">Amount:</div><div>Rp. 280,800</div></td>
</tr>
</tbody></table>`;

const BILLS_HTML = `
<table><thead><tr><th>Bill ID</th><th>Order ID</th><th>Created At</th>
<th>Process Date</th><th>Paid Date</th><th>Receivable</th><th>Status</th></tr></thead>
<tbody>
<tr>
  <td><div class="lg:hidden">Bill ID:</div><div>56703</div></td>
  <td><div class="lg:hidden">Order ID:</div><div>183420</div></td>
  <td><div class="lg:hidden">Created At:</div><div>2026-10-26 10:55</div></td>
  <td><div class="lg:hidden">Process Date:</div><div>-</div></td>
  <td><div class="lg:hidden">Paid Date:</div><div>-</div></td>
  <td><div class="lg:hidden">Receivable:</div><div>Rp. 1,770,000</div></td>
  <td><div class="lg:hidden">Status:</div><div>pending</div></td>
</tr>
</tbody></table>`;

const HISTORY_HTML = `
<table><thead><tr><th>Id</th><th>Process Date</th><th>Paid Date</th>
<th>Total Amount</th><th>Bank</th><th>Attachment</th><th>Order Ids</th></tr></thead>
<tbody>
<tr>
  <td><div class="lg:hidden">Id:</div><div>9128</div></td>
  <td><div class="lg:hidden">Process Date:</div><div>2026-10-13 11:00</div></td>
  <td><div class="lg:hidden">Paid Date:</div><div>2026-10-13 20:56:12</div></td>
  <td><div class="lg:hidden">Amount:</div><div>Rp. 19,466,450</div></td>
  <td><div class="lg:hidden">Bank:</div><div>mandiri</div></td>
  <td><div class="lg:hidden">Attachment:</div><div></div></td>
  <td><div class="lg:hidden">Order Ids:</div><div>182036, 182055, 182102</div></td>
</tr>
<tr>
  <td><div class="lg:hidden">Id:</div><div>9246</div></td>
  <td><div class="lg:hidden">Process Date:</div><div>2026-10-16 10:00</div></td>
  <td><div class="lg:hidden">Paid Date:</div><div>2026-10-16 16:55:00</div></td>
  <td><div class="lg:hidden">Amount:</div><div>Rp. 756,000</div></td>
  <td><div class="lg:hidden">Bank:</div><div>mandiri</div></td>
  <td><div class="lg:hidden">Attachment:</div><div></div></td>
  <td><div class="lg:hidden">Order Ids:</div><div>183420</div></td>
</tr>
</tbody></table>`;

describe("parseRupiah", () => {
  it("format koma ribuan portal", () => {
    expect(parseRupiah("Rp. 1,770,000")).toBe(1770000);
    expect(parseRupiah("Rp. 44,000")).toBe(44000);
    expect(parseRupiah("Rp. 19,466,450")).toBe(19466450);
  });

  it("bukan angka = 0", () => {
    expect(parseRupiah("-")).toBe(0);
    expect(parseRupiah("")).toBe(0);
  });
});

describe("parser payments", () => {
  it("billables: order, customer, purpose, amount + nilai numerik", () => {
    const list = parseBillablesPage(BILLABLE_HTML);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      orderId: "183420",
      customer: "Departemen Contoh Contoh",
      deliveryDate: "2026-10-25",
      purpose: "Rapat Anggaran",
      amount: "Rp. 1,770,000",
      amountValue: 1770000,
    });
  });

  it("bills: id tagihan, order, tanggal, receivable, status", () => {
    const list = parseBillsPage(BILLS_HTML);
    expect(list).toHaveLength(1);
    expect(list[0].billId).toBe("56703");
    expect(list[0].orderId).toBe("183420");
    expect(list[0].status).toBe("pending");
    expect(list[0].receivableValue).toBe(1770000);
    expect(list[0].processDate).toBe("-");
  });

  it("history: total, bank, daftar order id terpisah koma", () => {
    const list = parseHistoryPage(HISTORY_HTML);
    expect(list).toHaveLength(2);
    expect(list[0].totalValue).toBe(19466450);
    expect(list[0].bank).toBe("mandiri");
    expect(list[0].orderIds).toEqual(["182036", "182055", "182102"]);
    expect(list[1].orderIds).toEqual(["183420"]);
  });

  it("halaman tanpa tbody = kosong", () => {
    expect(parseBillsPage("<html></html>")).toEqual([]);
  });
});

describe("tanggal & label status", () => {
  it("tanggal+jam ISO portal → format pendek Indonesia", () => {
    expect(tanggalJamPendek("2026-10-26 10:55:17")).toBe("26 Okt 2026 · 10:55");
    expect(tanggalPendekItsfood("2026-10-16 16:55:00")).toBe("16 Okt 2026");
  });

  it("input bukan ISO diteruskan apa adanya ( '-' dst )", () => {
    expect(tanggalJamPendek("-")).toBe("-");
  });

  it("status tagihan portal → label manusia + tone pill", () => {
    expect(labelStatusBill("pending")).toEqual({
      label: "Menunggu Pembayaran",
      tone: "warning",
    });
    expect(labelStatusBill("paid")).toEqual({ label: "Terbayar", tone: "success" });
    // varian ejaan portal semuanya jatuh ke "Diproses"
    expect(labelStatusBill("process")).toEqual({ label: "Diproses", tone: "neutral" });
    expect(labelStatusBill("processed")).toEqual({ label: "Diproses", tone: "neutral" });
    expect(labelStatusBill("PROCESSED")).toEqual({ label: "Diproses", tone: "neutral" });
    expect(labelStatusBill("aneh")).toEqual({ label: "aneh", tone: "neutral" });
  });
});

const PAYMENT_DETAIL_HTML = `
<section class="mb-8">
  <h2>Detail</h2>
  <ul>
    <li><h5 class="font-bold text-sm text-gray-500">Process Date:</h5><span>2026-10-16 10:42:25</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Created At:</h5><span>2026-10-16 10:42:25</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Total Amount:</h5><span>Rp. 756,000</span></li>
  </ul>
  <ul>
    <li><h5 class="font-bold text-sm text-gray-500">Paid Date:</h5><span>2026-10-16 16:55:00</span></li>
    <li><h5 class="font-bold text-sm text-gray-500">Bank:</h5><span>mandiri</span></li>
  </ul>
</section>
<section>
  <table><thead><tr><th>Bill Id</th><th>Order Id</th><th>Delivery Date</th><th>Payable</th><th>Billed At</th></tr></thead>
  <tbody>
    <tr>
      <td><div class="lg:hidden">Bill Id:</div><div>55438</div></td>
      <td><div class="lg:hidden">Order Id:</div><div>182308</div></td>
      <td><div class="lg:hidden">Delivery Date:</div><div>2026-10-15 11:30:00</div></td>
      <td><div class="lg:hidden">Payable:</div><div>Rp. 756,000</div></td>
      <td><div class="lg:hidden">Billed At:</div><div>2026-10-15 14:18:34</div></td>
    </tr>
  </tbody></table>
</section>`;

describe("parsePaymentDetail", () => {
  it("field identitas + rincian bills per order", () => {
    const d = parsePaymentDetail(PAYMENT_DETAIL_HTML, "9246");
    expect(d?.processDate).toBe("2026-10-16 10:42:25");
    expect(d?.paidDate).toBe("2026-10-16 16:55:00");
    expect(d?.bank).toBe("mandiri");
    expect(d?.totalValue).toBe(756000);
    expect(d?.bills).toEqual([
      {
        billId: "55438",
        orderId: "182308",
        deliveryDate: "2026-10-15 11:30:00",
        payable: "Rp. 756,000",
        payableValue: 756000,
        billedAt: "2026-10-15 14:18:34",
      },
    ]);
  });

  it("halaman tanpa section = null", () => {
    expect(parsePaymentDetail("<html></html>", "1")).toBeNull();
  });
});

describe("linkWa", () => {
  it("nomor lokal 0 → 62", () => {
    expect(linkWa("081336663713")).toBe("https://wa.me/6281336663713");
  });

  it("sudah internasional & ada karakter lain", () => {
    expect(linkWa("+62 813-3666-3713")).toBe("https://wa.me/6281336663713");
    expect(linkWa("6281336663713")).toBe("https://wa.me/6281336663713");
  });

  it("tidak masuk akal = null", () => {
    expect(linkWa("")).toBeNull();
    expect(linkWa("123")).toBeNull();
    expect(linkWa("-")).toBeNull();
  });
});

describe("ringkasanWa", () => {
  it("berisi alamat, jam antar, item, catatan — dalam format WA", () => {
    const d = parseOrderDetail(DETAIL_HTML, "183712");
    const teks = ringkasanWa(
      {
        id: "183712",
        deliveryDate: "2026-10-27",
        deliveryTime: "11:00:00",
        address: "Alamat fallback",
      },
      d,
    );
    const baris = teks.split("\n");
    expect(baris[0]).toBe("*📦 Order #183712*");
    // jam & tanggal antar dibold
    expect(teks).toContain("🛵 Antar: *27 Okt 2026 11:00:00*");
    expect(teks).toContain("📞 No: 081200000000");
    expect(teks).toContain("📍 Alamat: Gedung Contoh Lt. 5");
    expect(teks).toContain("🍽 *Pesanan:*");
    expect(teks).toContain("• 25x Paket Gubuk — Rp. 1,100,000");
    expect(teks).toContain("📝 Catatan: Tolong jam 11 tepat");
    // karakter format WA jangan bocor dari nama item
    expect(teks).not.toMatch(/Paket Gubuk[*_~]/);
  });

  it("tanpa detail: alamat fallback + pesan rincian belum termuat", () => {
    const teks = ringkasanWa({
      id: "183712",
      deliveryDate: "2026-10-27",
      deliveryTime: "11:00:00",
      address: "Alamat fallback",
    });
    expect(teks).toContain("📍 Alamat: Alamat fallback");
    expect(teks).toContain("Pesanan: (rincian belum termuat)");
  });
});

describe("rekap & peta pembayaran", () => {
  const billables = parseBillablesPage(BILLABLE_HTML);
  const bills = parseBillsPage(BILLS_HTML);
  const history = parseHistoryPage(HISTORY_HTML);

  it("omzet = bisa ditagih + proses + terbayar", () => {
    const rekap = rekapPembayaranDari(billables, bills, history);
    // 1,770,000 + 280,800 (billable) + 1,770,000 (pending) + 19,466,450 + 756,000 (paid)
    expect(rekap.bisaDitagih).toBe(2050800);
    expect(rekap.prosesPembayaran).toBe(1770000);
    expect(rekap.sudahDibayar).toBe(20222450);
    expect(rekap.omzet).toBe(24043250);
  });

  it("status bayar order mengikuti prioritas terbayar > pending > billable", () => {
    const peta = petaBayarDari(billables, bills, history);
    // 183420 ada di billable DAN di history (fixture dibuat overlap untuk
    // menguji prioritas) → terbayar menang.
    expect(statusBayarOrder("183420", peta)).toBe("terbayar");
    // 183328 hanya contoh order di bills asli; di fixture pakai 183441.
    expect(statusBayarOrder("183441", peta)).toBe("bisa-ditagih");
    expect(statusBayarOrder("999999", peta)).toBe("belum-bisa");
  });

  it("order yang hanya punya tagihan pending = pending", () => {
    const peta = petaBayarDari([], bills, []);
    expect(statusBayarOrder("183420", peta)).toBe("pending");
  });
});
