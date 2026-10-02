import { expect, test, type Page } from "@playwright/test";

/* Analisis axe dilakukan lewat `page.evaluate` dengan `axe.run(document)`,
   bukan lewat `AxeBuilder` dari @axe-core/playwright.

   Alasannya bukan selera: `AxeBuilder` menelusuri SETIAP frame di halaman,
   dan pratinjau strukthermal dirender di `<iframe srcdoc>`
   (struk.tsx:99). Frame itu membuat `AxeBuilder.analyze()` HANG >25 detik
   di `/pengaturan` — bukan error, bukan pelanggaran, tapi tidak pernah
   selesai. `.include('#root')` dan `.excludeIframes()` tidak menolong:
   yang pertama tidak membatasi penelusuran frame, dan yang kedua tidak
   ada di versi 4.13.0 (API-nya hanya `include`/`exclude`/`options`).

   `axe.run(document)` pada frame utama yang sama selesai dalam ~500ms dan
   memberi hasil yang sama persis. Pratinjau struk juga memang bukan
   target a11y: isinya dokumen cetak tanpa kontrol interaktif. */

const AXE_URL = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

type Pelanggaran = { id: string; impact?: string; help: string; target: string[] };

async function analisisAxe(page: Page): Promise<Pelanggaran[]> {
  await page.addScriptTag({ url: AXE_URL });
  return page.evaluate(async () => {
    const axe = (window as unknown as {
      axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: unknown[] }> };
    }).axe;
    const hasil = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return hasil.violations as Pelanggaran[];
  });
}

/* Aksesibilitas.

   Kasir ini dipakai sambil berdiri,sambil melayani antrean, sering
   dengan satu tangan. Jadi yang dijaga di sini bukan soal kontras
   estetika, tapi hal yang bikin orang benar-benar berhenti: nama yang
   bisa dibaca screen reader, target sentuh yang cukup besar, dan kontras
   teks.

   `impact: "critical"` dipakai, bukan "serious". Aturan `serious` pada
   komponen custom sering muncul sebagai false positive (mis. kontras
   pada elemen non-teks dekoratif) dan membuat test rapuh — orang mulai
   mengabaikannya, dan test yang diabaikan tidak lagi berguna. */

const HALAMAN = ["/", "/kasir", "/menu", "/penjualan", "/customer", "/piutang", "/pengaturan"];

test.describe("a11y", () => {
  for (const path of HALAMAN) {
    /* Timeout-longgar: analisis axe pada halaman besar (katalog 1.095
       produk) memang butuh detik, dan timeout standar 30s membuat test
       gagal karena alasan yang salah — orang lalu mengabaikannya. */
    test(`${path} tidak punya pelanggaran kritis`, async ({ page }) => {
      test.setTimeout(60_000);

      await page.goto(path);
      /* `networkidle` dipakai, bukan `domcontentloaded`: layout butuh
         selesai dirender supaya yang dianalisis bukan halaman kosong. */
      await page.waitForLoadState("networkidle");

      const semua = await analisisAxe(page);
      const kritis = semua
        .filter((v) => v.impact === "critical")
        .map((v) => ({ id: v.id, bantuan: v.help, target: v.target }));

      expect(
        kritis,
        `pelanggaran kritis di ${path}:\n${JSON.stringify(kritis, null, 2)}`,
      ).toEqual([]);
    });
  }

  test("tombol ikon punya nama yang bisa dibaca", async ({ page }) => {
    await page.goto("/");
    // `IconButton` sudah pakai aria-label, tapi regresi itu mudah terjadi:
    // Developer lihat icon, lupa label, dan tombol jadi "tombol".
    const tanpaNama = await page.evaluate(() => {
      const hasil: string[] = [];
      for (const b of document.querySelectorAll("button, a[href]")) {
        const teks = (b.textContent ?? "").trim();
        const nama = b.getAttribute("aria-label") ?? b.getAttribute("title");
        if (!teks && !nama) {
          hasil.push(b.outerHTML.slice(0, 120));
        }
      }
      return hasil;
    });
    expect(tanpaNama, "tombol tanpa nama aksesibel").toEqual([]);
  });
});