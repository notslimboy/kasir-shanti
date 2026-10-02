import { describe, expect, it } from "vitest";

import { gabungStruk, tinggiHalamanMm } from "./cetak-struk";
import { cssStruk, STRUK_DEFAULT } from "./struk";

/* Dua aturan yang menentukan apakah struk keluar sebagai satu kertas atau
   terpotong: @page harus memakai millimeter, dan beberapa struk tidak boleh
   digabung tanpa pemisah. */

describe("tinggiHalamanMm", () => {
  it("px → mm dengan pembulatan ke atas", () => {
    // 200 px = 52,9 mm → 52,9 + 0,5 → 54 (bukan 53: pembulatan ke atas)
    expect(tinggiHalamanMm(200)).toBe(54);
  });

  it("strut pendek tetap dapat halaman minimum", () => {
    expect(tinggiHalamanMm(4)).toBe(30);
  });

  it("nilai bukan angka dihitung 0, bukan NaN", () => {
    expect(tinggiHalamanMm(Number.NaN)).toBe(30);
    expect(tinggiHalamanMm(-50)).toBe(30);
  });
});

describe("gabungStruk", () => {
  it("satu struk tidak memakai kelas batch", () => {
    const html = gabungStruk([{ html: "<p>a</p>" }]);
    expect(html).toBe('<article class="receipt-paper"><p>a</p></article>');
    expect(html).not.toContain("receipt-batch-separator");
  });

  it("beberapa struk dipisah dan diberi kelas batch", () => {
    const html = gabungStruk([{ html: "<p>a</p>" }, { html: "<p>b</p>" }]);
    expect(html).toContain('<article class="receipt-paper batch-receipt">');
    expect(html.match(/receipt-batch-separator/g)).toHaveLength(1);
  });

  it("tanpa pemisah di struk pertama supaya tidak ada garis di atas", () => {
    const html = gabungStruk([{ html: "<p>a</p>" }, { html: "<p>b</p>" }]);
    expect(html.startsWith("<article")).toBe(true);
  });

  /* Pasangan yang harus selalu utuh: HTML menyisipkan elemen pemisah, CSS
     harus punya aturan untuk elemen itu. Div tanpa garis = dua struk
     saling menyambung dan kasir tidak tahu di mana satu berakhir. */
  it("elemen pemisah punya aturan CSS (garis putus-putus selebar kertas)", () => {
    const html = gabungStruk([{ html: "<p>a</p>" }, { html: "<p>b</p>" }]);
    expect(html).toContain("receipt-batch-separator");

    const css = cssStruk(STRUK_DEFAULT);
    const aturan = css.match(/\.receipt-batch-separator\s*\{[^}]*\}/)?.[0];
    expect(aturan).toBeDefined();
    expect(aturan).toContain("border-top");
    expect(aturan).toContain("dashed");
    expect(aturan).toContain("var(--receipt-print-width)");
  });
});