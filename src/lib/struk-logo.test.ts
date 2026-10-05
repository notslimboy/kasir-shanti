import { describe, expect, it } from "vitest";

import { STRUK_DEFAULT, logoStruk, strukHtml, type DataStruk } from "./struk";

/* Logo struk adalah file PNG statis di `public/thermal/`. Before this test
   existed, both files had never been committed — `git log --all -- "public/
   thermal/*"` was empty — so every receipt printed a broken-image icon with
   the alt text instead of the logo, in production and in dev alike.
   Nothing caught it because the test suite only ever asserted the file
   *path*, which was always correct. */

const LOGO_58 = "public/thermal/logo-thermal-256-threshold.png";
const LOGO_80 = "public/thermal/logo-thermal-320-threshold.png";

/** Data minimal; isinya tidak relevan, yang diperiksa hanya struk logo. */
const DATA: DataStruk = {
  receiptNo: "SH-20261005-0001",
  payment: "Tunai",
  customerName: "Uji",
  chatDate: "05/10/2026 19.01",
  queueNo: null,
  sendNote: "",
  subtotal: 1000,
  shipping: 0,
  total: 1000,
  items: [{ name: "Nasi Goreng", variant: "Normal", qty: 1, price: 1000, lineTotal: 1000 }],
};

describe("logo struk", () => {
  it("file logo benar-benar ada di public/", async () => {
    /* Existence checked through the filesystem, not through the returned
       path. The path was always right; the file was not. */
    const { existsSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../../", import.meta.url));

    for (const f of [LOGO_58, LOGO_80]) {
      expect(
        existsSync(root + f),
        `${f} tidak ada — struk akan cetak ikon gambar rusak`,
      ).toBe(true);
    }
  });

  it("file logo bukan file kosong", async () => {
    const { statSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../../", import.meta.url));

    for (const f of [LOGO_58, LOGO_80]) {
      expect(statSync(root + f).size, `${f} berukuran nol byte`).toBeGreaterThan(0);
    }
  });

  it("path logo yang dipakai struk sama persis dengan nama filenya", () => {
    /* The mismatch is the failure this guards: `logoStruk()` returns
       "/thermal/…", which only resolves if the file sits in
       `public/thermal/`. If someone renames one side, this fails instead of
       the receipt. */
    expect(logoStruk("58")).toBe("/thermal/logo-thermal-256-threshold.png");
    expect(logoStruk("80")).toBe("/thermal/logo-thermal-320-threshold.png");
  });

  it("struk 58mm memakai logo 256 dan struk 80mm memakai logo 320", () => {
    expect(strukHtml(DATA, { ...STRUK_DEFAULT, receiptWidth: "58" })).toContain(LOGO_58.split("/").pop()!);
    expect(strukHtml(DATA, { ...STRUK_DEFAULT, receiptWidth: "80" })).toContain(LOGO_80.split("/").pop()!);
  });

  it("logo diberi alt text supaya hasil cetak tidak kosong diam-diam", () => {
    /* If the file ever goes missing again, the alt text is what the cashier
       sees. It has to describe the shop, not say "image". */
    const html = strukHtml(DATA, STRUK_DEFAULT);
    expect(html).toContain('alt="Logo Shanti Catering"');
  });
});
