import { describe, expect, it } from "vitest";

import {
  cssStruk,
  PRINTER_DEFAULT,
  STRUK_DEFAULT,
  formatRupiah,
  lebarCetakMm,
  lebarLogoCetakPx,
  logoStruk,
  namaItemStruk,
  normalisasiCatatanKirim,
  strukHtml,
  tipografiStruk,
  UKURAN_FONT_STRUK,
  type DataStruk,
} from "./struk";

/* Bentuk struk tidak boleh berubah. Struk yang keluar dari printer warmer
   punya bentuk tertentu dan sudah dibaca oleh kasir dan pelanggan. Test ini
   mengunci urutannya — perubahan susunan di sini berarti perubahan di meja. */

/** Intl untuk id-ID memakai spasi non-breaking (U+00A0 / U+202F) setelah
    "Rp". Itu perilaku yang sama dengan aplikasi lama, jadi yang dinormalkan
    justru test-nya — bukan format struknya. */
const rapikan = (s: string) => s.replace(/[\u00a0\u202f\u2009]/g, " ");

const data = (p: Partial<DataStruk> = {}): DataStruk => ({
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
    { name: "Es Kopi Susu", variant: "Separuh", qty: 2, price: 18_000 },
  ],
  ...p,
});

describe("default printer & toko — disalin dari app lama", () => {
  it("lebar kertas default 58mm", () => {
    expect(STRUK_DEFAULT.receiptWidth).toBe("58");
  });

  it("data toko sama persis", () => {
    expect(STRUK_DEFAULT.storeName).toBe("Shanti Catering");
    expect(STRUK_DEFAULT.storeAddress).toBe("BHASKARA III / 38");
    expect(STRUK_DEFAULT.footer).toBe("== TERIMA KASIH ==");
    expect(STRUK_DEFAULT.receiptFontSize).toBe("large");
    expect(STRUK_DEFAULT.receiptMode).toBe("complete");
  });

  it("pengaturan printer sama", () => {
    expect(PRINTER_DEFAULT).toEqual({
      language: "esc-pos",
      cut: "partial",
      feedLines: 0,
      nativePrinterTransport: "bluetooth",
      nativePrinterPort: "9100",
      autoPrint: true,
      printFlow: "direct",
    });
  });
});

describe("lebar & logo", () => {
  it("58mm memakai area cetak 48mm", () => {
    expect(lebarCetakMm("58")).toBe(48);
    expect(logoStruk("58")).toBe("/thermal/logo-thermal-256-threshold.png");
    expect(lebarLogoCetakPx("58")).toBe(128);
  });

  it("80mm memakai area cetak 72mm dan logo lebih besar", () => {
    expect(lebarCetakMm("80")).toBe(72);
    expect(logoStruk("80")).toBe("/thermal/logo-thermal-320-threshold.png");
    expect(lebarLogoCetakPx("80")).toBe(160);
  });
});

describe("tipografi", () => {
  it("large: body 13, small 12, emphasis 15, heading 11", () => {
    expect(UKURAN_FONT_STRUK.large).toEqual({ body: 13, small: 12 });
    expect(tipografiStruk("large")).toEqual({
      body: "13px", small: "12px", emphasis: "15px", heading: "11px", total: "13px",
    });
  });

  it("kunci tidak dikenal jatuh ke large", () => {
    expect(tipografiStruk("ngawur" as "large")).toEqual(tipografiStruk("large"));
  });
});

describe("format rupiah", () => {
  it("pakai Rp dan id-ID, tanpa desimal", () => {
    expect(rapikan(formatRupiah(256_000))).toBe("Rp 256.000");
    expect(rapikan(formatRupiah(0))).toBe("Rp 0");
  });
});

describe("catatan kirim", () => {
  it("kata Franchise saja dibuang", () => {
    for (const s of ["kirim", "Kirim", "diantar", "titip", "drop", "anter"]) {
      expect(normalisasiCatatanKirim(s)).toBe("");
    }
  });

  it("catatan yang berisi informasi tetap tampil", () => {
    expect(normalisasiCatatanKirim("  masuk  pintu   belakang ")).toBe("masuk pintu belakang");
  });

  it("tanda baca di tepi dibuang", () => {
    expect(normalisasiCatatanKirim("--titip satpam--")).toBe("titip satpam");
  });
});

describe("nama item struk", () => {
  it("varian Normal tidak ikut disebut", () => {
    expect(namaItemStruk({ name: "Nasi Goreng", variant: "Normal", qty: 1, price: 20_000 })).toBe("Nasi Goreng");
  });

  it("varian lain ikut disebut", () => {
    expect(namaItemStruk({ name: "Nasi Goreng", variant: "Separuh", qty: 1, price: 10_000 })).toBe("Nasi Goreng (Separuh)");
  });

  it("receiptLabel menang atas varian", () => {
    expect(
      namaItemStruk({ name: "Nasi", variant: "Separuh", qty: 1, price: 10_000, receiptLabel: "Separuh porsi" }),
    ).toBe("Nasi (Separuh porsi)");
  });
});

describe("urutan baris struk", () => {
  const html = rapikan(strukHtml(data()));

  it("urutan WAJIB sama dengan aplikasi lama", () => {
    const urutan = [
      "receipt-logo",
      "receipt-store-name",
      "receipt-store-address",
      "receipt-customer",
      "receipt-queue",
      "receipt-item-name",
      "Subtotal",
      "Ongkir",
      "Pembayaran",
      "TOTAL BAYAR",
      "TERIMA KASIH",
    ];
    let posisi = -1;
    for (const penanda of urutan) {
      const di = html.indexOf(penanda);
      expect(di, `penanda tidak ditemukan: ${penanda}`).toBeGreaterThan(-1);
      expect(di, `urutan terbalik di: ${penanda}`).toBeGreaterThan(posisi);
      posisi = di;
    }
  });

  it("logo memakai berkas 58mm saat default", () => {
    expect(html).toContain("/thermal/logo-thermal-256-threshold.png");
  });

  it("nama & alamat toko ikut tampil", () => {
    expect(html).toContain("Shanti Catering");
    expect(html).toContain("BHASKARA III / 38");
  });

  it("nomor antre menggantikan tanggal chat kalau ada", () => {
    expect(html).toContain("NO: 63");
    expect(html).not.toContain("30/09/2026 09.12");
  });

  it("tanpa nomor antre, tanggal chat yang tampil", () => {
    const h = rapikan(strukHtml(data({ queueNo: null })));
    expect(h).toContain("30/09/2026 09.12");
    expect(h).not.toContain("NO:");
  });

  it("baris item memakai format qty x harga", () => {
    // Tag HTML memisahkan angka qty dari "x harga", jadi keduanya diperiksa
    // terpisah — jangan menebak teksnya nyambung.
    expect(html).toContain('class="receipt-quantity">3</strong>');
    expect(html).toContain(" x Rp 30.000");
    expect(html).toContain("Rp 90.000");
  });

  it("tag span tertutup dengan benar", () => {
    // dulu <span> ditutup </strong> di baris harga item.
    expect(html).not.toMatch(/receipt-item-unit[\s\S]{0,200}<\/span><\/strong>/);
    expect(html).toContain("</span></span>");
  });

  it("total yang dibayar dikurangi deposit", () => {
    const h = rapikan(strukHtml(data({ usedDeposit: 100_000 })));
    expect(h).toContain("Potongan Deposit");
    expect(h).toContain("-Rp 100.000");
    expect(h).toContain("Rp 156.000");
  });

  it("keranjang kosong tetap menghasilkan struk yang utuh", () => {
    const h = rapikan(strukHtml(data({ items: [] })));
    expect(h).toContain("Keranjang kosong");
    expect(h).toContain("TOTAL BAYAR");
  });

  it("mode compact menyembunyikan alamat toko & footer", () => {
    const h = rapikan(strukHtml(data(), { ...STRUK_DEFAULT, receiptMode: "compact" }));
    expect(h).not.toContain("BHASKARA III / 38");
    expect(h).not.toContain("TERIMA KASIH");
    // Class compact-header tetap ada, sama seperti app lama
    expect(h).toContain("receipt-compact-header");
  });

  it("nama dengan tanda HTML di-escape", () => {
    const h = rapikan(strukHtml(
      data({ items: [{ name: "<script>alert(1)</script>", variant: "Normal", qty: 1, price: 1_000 }] }),
    ));
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });

  it("catatan item tampil sebagai 'Catatan:'", () => {
    const h = rapikan(strukHtml(
      data({ items: [{ name: "Nasi", variant: "Normal", qty: 1, price: 1_000, note: "sambal pisah" }] }),
    ));
    expect(h).toContain("Catatan: sambal pisah");
  });

  it("catatan kirim tidak tampil kalau isinya cuma kata kirim", () => {
    expect(strukHtml(data({ sendNote: "kirim" }))).not.toContain("CATATAN KIRIM");
    expect(strukHtml(data({ sendNote: "titip satpam" }))).toContain("CATATAN KIRIM");
  });
});

describe("css struk", () => {
  it("memakai Courier New dan tebal, tanpa radius", () => {
    const css = cssStrukSafe();
    expect(css).toContain('"Courier New"');
    expect(css).toContain("font-weight: 600");
    expect(css).toContain("border-radius: 0");
  });

  it("ukuran kertas ikut lebar", () => {
    expect(cssStrukSafe({ ...STRUK_DEFAULT, receiptWidth: "58" })).toContain("--receipt-print-width: 48mm");
    expect(cssStrukSafe({ ...STRUK_DEFAULT, receiptWidth: "80" })).toContain("--receipt-print-width: 72mm");
  });
});

const cssStrukSafe = cssStruk;

describe("nilai bawaan tidak boleh dikarang ulang", () => {
  it("halaman Pengaturan memakai STRUK_DEFAULT, bukan angka karangan", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/pages/pengaturan.tsx"), "utf-8");

    // Data toko karangan yang pernah dipakai harus tidak muncul lagi.
    expect(src).not.toContain("CATERING SHANTI");
    expect(src).not.toContain("Jl. Raya Darmo Permai III No. 88");
    expect(src).not.toContain("0812-3456-7890");
    // Halaman tidak lagi menyebut STRUK_DEFAULT secara langsung: setelan
    // printer disimpan sebagai state dan diteruskan lewat <Struk setelan=…>.
    // Yang diuji di sini adalah arah ketergantungan yang benar — default
    // milik satu tempat saja (lib/struk.ts), halaman tidak mengarangnya.
    expect(src).toContain("strukContoh()");
    // Lebar kertas boleh disimpan sebagai state, asal tidak dikunci ke
    // angka tetap.
    //
    // Hanya assertion regex ini yang dipakai. Versi sebelumnya juga punya
    // `not.toContain("receiptWidth =")`, dan itu kelalaian: string
    // "receiptWidth =" ikut muncul di operator perbandingan
    // `setelan.receiptWidth === k`, sehingga assertion itu gagal bukan
    // karena ada hardcode angka, melainkan karena ada perbandingan biasa.
    // Nilai yang dikunci tanpa kutip pun
    // harus tertangkap, misalnya `receiptWidth: 58`.
    expect(src).not.toMatch(/receiptWidth\s*[:=]\s*["']?\s*(58|80)\b/);
    // …dan angka itu tidak boleh muncul sebagai warna/huruf acak pun,
    // jadi pastikan memang tidak ada penulisan `receiptWidth` yang
    // mengunci literal sama sekali.
    expect(src).not.toMatch(/receiptWidth\s*[:=]\s*["'][^"']+["']/);
    const strukSrc = readFileSync(resolve(process.cwd(), "src/lib/struk.ts"), "utf-8");
    expect(strukSrc).toContain("STRUK_DEFAULT");
    // Default-nya dipasang sebagai DEFAULT PARAMETER, bukan sebagai
    // konstanta `const setelan = …`. Bentuk parameternya yang diuji di
    // sini, karena itulah yang membuat strukHtml() dan cssStruk() tetap
    // benar saat dipanggil tanpa setelan.
    expect(strukSrc).toMatch(/setelan:\s*SetelanStruk\s*=\s*STRUK_DEFAULT/);
    // …dan keduanya harus memakainya, kalau tidak salah satunya diam-diam
    // memakai lebar kertas yang berbeda.
    expect(strukSrc).toMatch(/function strukHtml\([^)]*=\s*STRUK_DEFAULT/s);
    expect(strukSrc).toMatch(/function cssStruk\([^)]*=\s*STRUK_DEFAULT/s);
  });

  it("tidak ada halaman yang mengunci lebar kertas sendiri", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dir = resolve(process.cwd(), "src/pages");
    // Lebar kertas hanya boleh datang dari STRUK_DEFAULT atau state, tidak
    // dari angka yang diketik langsung di halaman.
    const salah = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /receiptWidth\s*[:=]\s*"(58|80)"/.test(readFileSync(resolve(dir, f), "utf-8")));
    expect(salah).toEqual([]);
  });

  it("pratinjau di Struk & Pengaturan lewat komponen Struk yang sama", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of ["pengaturan.tsx"]) {
      const src = readFileSync(resolve(process.cwd(), "src/pages", f), "utf-8");
      expect(src).toContain("<Struk");
    }
    const drawer = readFileSync(resolve(process.cwd(), "src/components/struk-drawer.tsx"), "utf-8");
    expect(drawer).toContain("<Struk");
    // Tidak boleh ada markup struk racikan sendiri di dalam drawer.
    expect(drawer).not.toContain("font-mono text-[11px]");
  });
});
