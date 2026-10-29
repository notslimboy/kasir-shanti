import type { Sale } from "./sale";
import type { BarisKurir } from "./kurir";

/* ==========================================================================
   Laporan penjualan 210 × 330 mm.

   Dipindah dari script.js (salesReportA4Html, baris 11049) tanpa mengubah
   bentuknya: ukuran kertas, margin, pemenggalan halaman detail, dan urutan
   bagian semuanya ikut apa adanya. Mengubah bentuk berarti laporan yang
   sudah dicetak tidak cocok dengan cetakan bulan lalu.

   210 × 330 mm bukan A4 (A4 = 297 mm): itu kertas laporan kontinu milik
   printer kasir, jadiTINGGI_ISI dipakai untuk membingkai @page supaya isi
   tidak terpotong antar halaman.
   ========================================================================== */

export const UKURAN_HALAMAN_LAPORAN = "210mm 330mm";
export const MARGIN_LAPORAN = "10mm";
export const LEBAR_ISI_LAPORAN = "190mm";
export const TINGGI_ISI_LAPORAN = "310mm";

/* Batas "unit" per halaman. Unit = perkiraan tinggi baris, bukan jumlah
   baris: nama panjang dan banyak item membuat satu struk memakan ruang
   berlipat ganda, lalu halaman pun jadi setengah kosong. */
const SATUAN_HALAMAN_1 = 40;
const SATUAN_HALAMAN = 46;
const SATUAN_BARIS_MIN = 2;
const CADANGAN_SUMMARY_KURIR = 3;

export type Pembayaran = { name: string; count: number; total: number };

export type OpsiLaporan = {
  struk: Sale[];
  /** Rentang laporan, hanya untuk judul. */
  labelRentang: string;
  ringkasan: {
    omset: number;
    transaksi: number;
    item: number;
    ongkir: number;
  };
  pembayaran: Pembayaran[];
  /** Rincian ongkir per area (sudah satu baris per kurir+tag). */
  ongkirPerTag: BarisKurir[];
  ongkirTotal: number;
  /** Nama kurir per struk; tabel detail mencantumkannya. */
  kurirUntuk: (s: Sale) => string;
  /** Waktu cetak, sudah diformat id-ID. */
  dicetakPada: string;
};

/* -------------------------------------------------------------------------
   Pemenggal halaman detail
   ---------------------------------------------------------------------- */

/** Perkiraan tinggi satu struk dalam "unit". Panjang nama dibulatkan ke
    atas supaya tidak pernah lebih rendah dari kenyataan — overflow di
    laporan lebih buruk daripada halaman yang agak longgar. */
export function perkiraanUnit(s: Sale): number {
  const nama = s.customer.trim() || "Customer belum diisi";
  const unitCustomer = Math.max(1, Math.ceil(nama.length / 24));
  const unitItem = s.lines.reduce((total, l) => {
    const teks = `${l.name}${l.note ? ` (${l.note})` : ""}`;
    return total + Math.max(1, Math.ceil(teks.length / 32));
  }, 0);
  return Math.max(SATUAN_BARIS_MIN, Math.max(unitCustomer, unitItem));
}

export type HalamanDetail<T> = { struk: T[]; mulai: number };

export function bagiHalamanDetail<T>(
  struk: T[],
  unitDari: (s: T) => number,
  opsi: { batasSatuanHalaman1?: number; cadanganHalamanAkhir?: number } = {},
): HalamanDetail<T>[] {
  if (struk.length === 0) return [{ struk: [], mulai: 0 }];

  const batas1 = opsi.batasSatuanHalaman1 ?? SATUAN_HALAMAN_1;
  const cadangan = opsi.cadanganHalamanAkhir ?? 0;
  const unit = (s: T) => Math.min(unitDari(s), SATUAN_HALAMAN);
  const batasHalaman = (i: number) => (i === 0 ? batas1 : SATUAN_HALAMAN);

  const halaman: HalamanDetail<T>[] = [];
  let isi: T[] = [];
  let mulai = 0;
  let totalUnit = 0;
  let nomor = 0;

  struk.forEach((s, index) => {
    const baris = unit(s);
    if (isi.length > 0 && totalUnit + baris > batasHalaman(nomor)) {
      halaman.push({ struk: isi, mulai });
      isi = [];
      totalUnit = 0;
      mulai = index;
      nomor += 1;
    }
    isi.push(s);
    totalUnit += baris;
  });
  if (isi.length > 0) halaman.push({ struk: isi, mulai });

  /* Halaman terakhir dibuat lega supaya tabel summary ongkir — yang ditempel
     di halaman terakhir — tidak mendorong halaman kosong tambahan. */
  if (cadangan > 0 && halaman.length > 0) {
    const target = Math.max(SATUAN_BARIS_MIN, batasHalaman(halaman.length - 1) - cadangan);
    const terakhir = halaman[halaman.length - 1];
    const unitTerakhir = () => terakhir.struk.reduce((a, s) => a + unit(s), 0);
    let luapan: HalamanDetail<T> | null = null;

    while (terakhir.struk.length > 1 && unitTerakhir() > target) {
      const pindah = terakhir.struk.pop();
      if (pindah === undefined) break;
      const indexPindah = terakhir.mulai + terakhir.struk.length;
      if (!luapan) luapan = { struk: [], mulai: indexPindah };
      luapan.struk.unshift(pindah);
      luapan.mulai = indexPindah;
    }
    if (luapan) halaman.push(luapan);
  }

  return halaman;
}

/* -------------------------------------------------------------------------
   Label tanggal
   ---------------------------------------------------------------------- */

/** "Rabu, 30 September 2026", persis seperti toLocaleDateString di
    formatDateLabel (script.js:1986). */
export function labelTanggal(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Label rentang laporan. Untuk satu hari, formatDateLabel lama menambah
    awalan "Hari ini," kalau tanggalnya sama dengan hari lokal — jadi
    laporan yang dicetak pagi tadi masih terbaca sebagai laporan hari ini. */
export function labelRentang(dari: string, sampai: string): string {
  const a = labelTanggal(dari);
  const b = labelTanggal(sampai);
  if (dari === sampai) {
    const hariIni = new Date();
    const isoHariIni = `${hariIni.getFullYear()}-${String(hariIni.getMonth() + 1).padStart(2, "0")}-${String(hariIni.getDate()).padStart(2, "0")}`;
    return dari === isoHariIni ? `Hari ini, ${a}` : a;
  }
  return `${a} - ${b}`;
}

/* -------------------------------------------------------------------------
   HTML
   ---------------------------------------------------------------------- */

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "Rp 1.234.500" — sama seperti currency.format di script.js lama, termasuk
   &nbsp; di antara "Rp" dan angkanya. Tanpa itu, "Rp 1.234.500" bisa terpotong
    di akhir baris tabel dan jadi "Rp" sendirian. */
const rupiah = (v: number): string =>
  `Rp&nbsp;${new Intl.NumberFormat("id-ID").format(Math.round(v))}`;

/** Diekspor untuk test laporan.test.ts — bentuk kolom nama adalah kontrak
 *  cetak yang sama di laporan dan di Detail Transaksi. */
export function barisTransaksi(s: Sale, index: number, kurir: string): string {
  /* Struk lunas dapat embel-embel "Lunas" tebal di kolom nama — "nama ->
     status" yang diminta kasir. Dipisah <span>, bukan nama + spasi: pelapor
     membaca kolom nama dari jauh, dan teks tambahannya harus bisa dicandak
     dari CSS, bukan diselip ke dalam nama yang di-esc. */
  const nama =
    esc(s.customer || "Customer belum diisi") +
    (s.status === "lunas" ? ' <span class="print-report-lunas">Lunas</span>' : "");
  const ongkir = s.ongkir ?? 0;
  const bayar = esc(s.payment || "Tunai");
  const kelas = (index + 1) % 2 === 0 ? ' class="row-even"' : "";
  const rowspan = Math.max(1, s.lines.length);
  const kurirSel = esc(kurir || "-");

  if (s.lines.length === 0) {
    return (
      `<tr${kelas}>` +
      `<td class="col-index">${index + 1}</td>` +
      `<td>${nama}</td>` +
      `<td class="print-report-courier-cell">${kurirSel}</td>` +
      `<td>-</td><td class="number">0</td><td class="number">0</td><td class="number">0</td>` +
      `<td class="number">${rupiah(ongkir)}</td>` +
      `<td class="number">${rupiah(s.total)}</td>` +
      `<td>${bayar}</td></tr>`
    );
  }

  return s.lines
    .map((l, i) => {
      const jumlah = l.qty * l.price;
      const menu = `${esc(l.name)}${l.note ? ` <small class="item-note">(${esc(l.note)})</small>` : ""}`;
      if (i === 0) {
        return (
          `<tr${kelas}>` +
          `<td rowspan="${rowspan}" class="col-index">${index + 1}</td>` +
          `<td rowspan="${rowspan}">${nama}</td>` +
          `<td rowspan="${rowspan}" class="print-report-courier-cell">${kurirSel}</td>` +
          `<td>${menu}</td>` +
          `<td class="number">${l.qty}</td>` +
          `<td class="number">${rupiah(l.price)}</td>` +
          `<td class="number">${rupiah(jumlah)}</td>` +
          `<td rowspan="${rowspan}" class="number">${rupiah(ongkir)}</td>` +
          `<td rowspan="${rowspan}" class="number">${rupiah(s.total)}</td>` +
          `<td rowspan="${rowspan}">${bayar}</td></tr>`
        );
      }
      return (
        `<tr${kelas}>` +
        `<td>${menu}</td>` +
        `<td class="number">${l.qty}</td>` +
        `<td class="number">${rupiah(l.price)}</td>` +
        `<td class="number">${rupiah(jumlah)}</td></tr>`
      );
    })
    .join("");
}

/** Baris judul + tabel untuk satu halaman detail. `header` hanya dipakai
    halaman lanjutan: halaman pertama sudah punya header laporan sendiri, dan
    di sana judulnya cukup "Detail Transaksi" (h2) — bukan "Daftar Pesanan"
    (h1) yang akan mengulang judul laporan. */
function bagianDetail(
  halaman: HalamanDetail<Sale>,
  totalTransaksi: number,
  labelRentang: string,
  nomor: number,
  totalHalaman: number,
  kurirUntuk: (s: Sale) => string,
  denganHeader: boolean,
): string {
  const awal = halaman.struk.length ? halaman.mulai + 1 : 0;
  const akhir = halaman.struk.length ? halaman.mulai + halaman.struk.length : 0;
  const posisi = halaman.struk.length
    ? `Transaksi ${awal}-${akhir} dari ${totalTransaksi}`
    : "Belum ada transaksi";

  const judul = denganHeader
    ? `
      <header class="print-report-header print-report-detail-header">
        <div>
          <p class="print-report-eyebrow">Detail Transaksi</p>
          <h1>Daftar Pesanan</h1>
          <p class="print-report-period">Tanggal laporan: ${esc(labelRentang)}</p>
          <p class="print-report-page-note">${esc(posisi)}</p>
        </div>
        <div class="print-report-meta">
          <span>Halaman detail</span>
          <strong>${nomor} / ${totalHalaman}</strong>
        </div>
      </header>`
    : `
        <div class="print-report-detail-title-row">
          <h2>Detail Transaksi</h2>
          <span>Halaman detail ${nomor} / ${totalHalaman}</span>
        </div>
        <p class="print-report-page-note">${esc(posisi)}</p>`;

  return `${judul}
      <section class="print-report-section print-report-detail-section">
        <table class="print-report-transactions">
          <thead>
            <tr><th>No</th><th>Customer</th><th>Kurir</th><th>Menu</th><th class="number">Qty</th><th class="number">Satuan</th><th class="number">Jumlah</th><th class="number">Ongkir</th><th class="number">Total</th><th>Bayar</th></tr>
          </thead>
          <tbody>${
            halaman.struk
              .map((s, i) => barisTransaksi(s, halaman.mulai + i, kurirUntuk(s)))
              .join("") || '<tr><td colspan="10">Belum ada transaksi pada rentang ini.</td></tr>'
          }</tbody>
        </table>
      </section>`;
}

function bagianKurir(opsi: OpsiLaporan): string {
  if (opsi.ongkirPerTag.length === 0) return "";
  const baris = opsi.ongkirPerTag
    .map(
      (r) =>
        `<tr><td>${esc(r.tag)}</td><td>${esc(r.kurir)}</td>` +
        `<td class="number">${r.count}</td><td class="number">${rupiah(r.total)}</td></tr>`,
    )
    .join("");
  const jumlah = opsi.ongkirPerTag.reduce((a, r) => a + r.count, 0);

  return `
      <section class="print-report-section print-report-courier-section">
        <div class="print-report-detail-title-row">
          <h2>Summary Ongkir Kurir</h2>
          <span>${jumlah} transaksi ongkir</span>
        </div>
        <table class="print-report-courier-table">
          <thead><tr><th>Tag Alamat</th><th>Kurir</th><th class="number">Transaksi</th><th class="number">Total Ongkir</th></tr></thead>
          <tbody>${baris}</tbody>
          <tfoot><tr><td colspan="3" class="print-report-total-label">Total Ongkir</td><td class="number">${rupiah(opsi.ongkirTotal)}</td></tr></tfoot>
        </table>
      </section>`;
}

export function laporanPenjualanHtml(opsi: OpsiLaporan): string {
  const urut = [...opsi.struk].sort(
    (a, b) => a.completedOn.localeCompare(b.completedOn) || a.completedAt.localeCompare(b.completedAt),
  );

  const totalTransaksi = opsi.ringkasan.transaksi;
  const adaKurir = opsi.ongkirPerTag.length > 0;
  /* Halaman terakhir dikasih ruang untuk tabel summary ongkir. Cadangan 3
     unit di aplikasi lama ternyata hanya cukup kalau tabelnya pendek —
     dengan 10+ area, tabel itu eats lebih dari satu halaman dan ikut terpotong.
     Cadangannya dihitung dari jumlah baris yang benar-benar akan dicetak. */
  const halaman = bagiHalamanDetail(urut, perkiraanUnit, {
    batasSatuanHalaman1: SATUAN_HALAMAN_1,
    cadanganHalamanAkhir: adaKurir ? CADANGAN_SUMMARY_KURIR + opsi.ongkirPerTag.length : 0,
  });

  const totalHalaman = halaman.length;
  const sisanya = halaman
    .slice(1)
    .map((h, i) => {
      const terakhir = i + 2 === totalHalaman;
      return `
    <article class="print-report-a4 print-report-page print-report-detail-page">
      ${bagianDetail(h, totalTransaksi, opsi.labelRentang, i + 2, totalHalaman, opsi.kurirUntuk, true)}
      ${terakhir ? bagianKurir(opsi) : ""}
    </article>`;
    })
    .join("");

  const barisBayar = opsi.pembayaran
    .map(
      (p) =>
        `<tr><td>${esc(p.name)}</td><td class="number">${p.count}</td><td class="number">${rupiah(p.total)}</td></tr>`,
    )
    .join("");

  const pertama = halaman[0] ?? { struk: [], mulai: 0 };

  return `
    <article class="print-report-a4 print-report-page">
      <header class="print-report-header">
        <div>
          <p class="print-report-eyebrow">Kasir Shanti Catering</p>
          <h1>Laporan Penjualan</h1>
          <p class="print-report-period">Tanggal laporan: ${esc(opsi.labelRentang)}</p>
        </div>
        <div class="print-report-meta"><span>Dicetak</span><strong>${esc(opsi.dicetakPada)}</strong></div>
      </header>

      <section class="print-report-summary">
        <div class="primary"><span>Total Omzet</span><strong>${rupiah(opsi.ringkasan.omset)}</strong></div>
        <div class="primary"><span>Total Pesanan</span><strong>${opsi.ringkasan.transaksi}</strong></div>
        <div><span>Total Item</span><strong>${opsi.ringkasan.item}</strong></div>
        <div><span>Total Ongkir</span><strong>${rupiah(opsi.ringkasan.ongkir)}</strong></div>
      </section>

      <section class="print-report-section">
        <h2>Ringkasan Pembayaran</h2>
        <table class="print-report-payment-table">
          <thead><tr><th>Metode</th><th class="number">Transaksi</th><th class="number">Total</th></tr></thead>
          <tbody>${barisBayar || '<tr><td colspan="3">Belum ada pembayaran.</td></tr>'}</tbody>
        </table>
      </section>

      <section class="print-report-section print-report-detail-section print-report-summary-detail">
        ${bagianDetail(pertama, totalTransaksi, opsi.labelRentang, 1, totalHalaman, opsi.kurirUntuk, false)}
      </section>
    </article>
    ${sisanya}
  `;
}
