/* Generated dari styles.css aplikasi lama — jangan diedit tangan. */
export const CSS_LAPORAN = `
/* ==========================================================================
   CSS laporan penjualan.

   Disalin apa adanya dari styles.css aplikasi lama (blok .print-report-*,
   baris 3452–3712) supaya cetakan bulan ini dan bulan lalu tidak berubah
   bentuknya. Aturan bertema gelap sengaja dibuang: yang dicetak adalah
   kertas putih, bukan tema aplikasi — kalau tidak, laporan yang dicetak dari
   mode gelap bisa keluar dengan warna terbalik.
   ========================================================================== */

.print-report-a4 {
  display: grid;
  gap: 11px;
  width: 100%;
  color: #17211d;
  background: #ffffff;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9.4pt;
  line-height: 1.28;
}

.print-report-page {
  display: grid;
  gap: 11px;
  min-width: 0;
}

.print-report-page + .print-report-page {
  margin-top: 18px;
}

.print-report-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 2px solid #0f766e;
  padding-bottom: 10px;
}

.print-report-eyebrow {
  margin: 0 0 4px;
  color: #0f766e;
  font-size: 9pt;
  font-weight: 800;
  text-transform: uppercase;
}

.print-report-header h1 {
  margin: 0;
  color: #111827;
  font-size: 21pt;
  line-height: 1;
}

.print-report-header p,
.print-report-meta span {
  margin: 5px 0 0;
  color: #52606d;
}

.print-report-period {
  font-size: 10pt;
  font-weight: 700;
}

.print-report-page-note {
  margin: 3px 0 0;
  color: #0f766e;
  font-size: 9pt;
  font-weight: 800;
}

.print-report-meta {
  min-width: 42mm;
  text-align: right;
}

.print-report-meta strong,
.print-report-meta span {
  display: block;
}

.print-report-summary {
  display: grid;
  grid-template-columns: 1.35fr 1fr repeat(2, 0.9fr);
  gap: 6px;
}

.print-report-summary div {
  border: 1px solid #d7e2dc;
  border-radius: 4px;
  background: #f6fbf8;
  padding: 7px 8px;
}

.print-report-summary div.primary {
  border-color: #99d7ca;
  background: #edf8f5;
}

.print-report-summary span {
  display: block;
  color: #52606d;
  font-size: 8.5pt;
  font-weight: 700;
}

.print-report-summary strong {
  display: block;
  margin-top: 3px;
  color: #0f5f58;
  font-size: 11.4pt;
  line-height: 1.1;
}

.print-report-section {
  display: grid;
  gap: 7px;
}

.print-report-section h2 {
  margin: 0;
  color: #111827;
  font-size: 11.2pt;
}

.print-report-detail-title-row {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 10px;
}

.print-report-detail-title-row span {
  color: #52606d;
  font-size: 8.4pt;
  font-weight: 800;
}

.print-report-summary-detail {
  margin-top: 2px;
}

.print-report-courier-section {
  break-inside: avoid;
  page-break-inside: avoid;
}

.print-report-a4 table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid #d7e2dc;
  table-layout: fixed;
}

.print-report-a4 thead {
  display: table-header-group;
}

.print-report-a4 tbody {
  display: table-row-group;
}

.print-report-a4 th,
.print-report-a4 td {
  border: 1px solid #d7e2dc;
  padding: 4px 5px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.print-report-a4 th {
  background: #eef7f3;
  color: #334155;
  font-size: 7.8pt;
  font-weight: 800;
  text-transform: uppercase;
}

.print-report-a4 .number {
  text-align: right;
  white-space: nowrap;
}

.print-report-payment-table th:nth-child(2),
.print-report-payment-table td:nth-child(2) {
  width: 24mm;
}

.print-report-payment-table th:nth-child(3),
.print-report-payment-table td:nth-child(3),
.print-report-menu-table th:nth-child(4),
.print-report-menu-table td:nth-child(4) {
  width: 28mm;
}

.print-report-menu-table th:nth-child(1),
.print-report-menu-table td:nth-child(1) {
  width: 10mm;
}

.print-report-menu-table th:nth-child(3),
.print-report-menu-table td:nth-child(3) {
  width: 24mm;
}

.print-report-courier-table th:nth-child(2),
.print-report-courier-table td:nth-child(2) {
  width: 28mm;
}

.print-report-courier-table th:nth-child(3),
.print-report-courier-table td:nth-child(3) {
  width: 22mm;
}

.print-report-courier-table th:nth-child(4),
.print-report-courier-table td:nth-child(4) {
  width: 32mm;
}

.print-report-courier-table tfoot td {
  background: #edf8f5;
  color: #0f5f58;
  font-weight: 900;
}

.print-report-total-label {
  text-align: right;
}

.print-report-transactions th,
.print-report-transactions td,
.print-report-transactions .number {
  text-align: center;
  vertical-align: middle;
}

.print-report-transactions th,
.print-report-transactions td {
  padding: 3px 3px;
}

.print-report-transactions th {
  font-size: 7.3pt;
  line-height: 1.1;
  white-space: nowrap;
}

.print-report-transactions td {
  font-size: 7.9pt;
  line-height: 1.2;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
}

.print-report-transactions tr.row-even td {
  background-color: rgba(0, 0, 0, 0.08) !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}



.print-report-transactions td .item-note {
  color: #6b7280;
  font-size: 7.5pt;
}

.print-report-transactions .print-report-courier-cell {
  color: #0f5f58;
  font-size: 7.5pt;
  font-weight: 800;
  line-height: 1.15;
}

.print-report-transactions th:nth-child(1),
.print-report-transactions td.col-index {
  width: 8mm;
  white-space: nowrap;
}

.print-report-transactions th:nth-child(2) { width: 24mm; }
.print-report-transactions th:nth-child(3) { width: 16mm; }
.print-report-transactions th:nth-child(4) { width: auto; }
.print-report-transactions th:nth-child(5) { width: 7mm; }
.print-report-transactions th:nth-child(6) { width: 17mm; }
.print-report-transactions th:nth-child(7) { width: 19mm; }
.print-report-transactions th:nth-child(8) { width: 16mm; }
.print-report-transactions th:nth-child(9) { width: 18mm; }
.print-report-transactions th:nth-child(10) { width: 11mm; }

/* --------------------------------------------------------------------------
   Aturan halaman cetak.
   Disalin dari styles.css lama (blok report-print-mode, baris 9066-9113).
   Inilah yang membuat tiap "halaman" benar-benar satu halaman kertas: tinggi
   setiap article dikunci ke tinggi area cetak, break-after page memaksa ganti
   sheet, dan overflow hidden mencegah isi yang meluber keluar diam-diam.

   Tanpa aturan ini, gambar di pratinjau cetak browser menyisakan ruang
   kosong besar di antara halaman — karena browser memakai tinggi viewport,
   bukan tinggi kertas.
   -------------------------------------------------------------------------- */
@media print {
  html.report-print-mode .print-report-a4 {
    display: block !important;
    width: var(--report-print-width);
    min-height: 0;
    color: #17211d;
    background: #fff;
    break-inside: auto;
    page-break-inside: auto;
  }

  html.report-print-mode .print-report-page {
    display: block !important;
    box-sizing: border-box;
    width: var(--report-print-width);
    height: var(--report-print-height);
    min-height: var(--report-print-height);
    /* overflow:hidden sengaja TIDAK dipakai. Di aplikasi lama halaman
       dipotong tepat di tinggi kertas, dan kalau tabel_summary ongkir
       ternyata lebih tinggi dari sisa halaman, tabel itu hilang begitu
       saja tanpa jejak. Di sini isi yang melebihi halaman flowed ke
       sheet berikutnya — satu halaman extra, tapi tidak ada data hilang. */
    break-inside: avoid-page;
    page-break-inside: avoid;
    break-after: page !important;
    page-break-after: always !important;
  }

  html.report-print-mode .print-report-page > * + * {
    margin-top: 9px;
  }

  html.report-print-mode .print-report-page + .print-report-page {
    margin-top: 0;
    break-before: page !important;
    page-break-before: always !important;
  }

  html.report-print-mode .print-report-page:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }

  html.report-print-mode .print-report-header,
  html.report-print-mode .print-report-summary div {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  html.report-print-mode .print-report-section,
  html.report-print-mode .print-report-a4 table,
  html.report-print-mode .print-report-a4 tbody {
    break-inside: auto;
    page-break-inside: auto;
  }

  @page {
    size: var(--report-page-size);
    margin: var(--report-page-margin);
  }

  html,
  body {
    width: var(--report-print-width);
    margin: 0;
    padding: 0;
    background: #fff;
  }
}


`;
