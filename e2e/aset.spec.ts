import { expect, test } from "@playwright/test";

import { pakaiSupabasePalsu } from "./fixture-supabase";

/* Static assets reach the browser.
 *
 * The thermal logo was never committed, and `vercel.json` rewrote every
 * unmatched path to `index.html`, so the missing file came back as 200 HTML.
 * The `<img>` failed to decode and the receipt printed a broken-image icon
 * with the alt text. This spec guards the two halves: the files are in the
 * build, and they are served as images.

 * The rewrite *rule* is asserted in `src/vercel-rewrite.test.ts` rather than
 * here — `vite preview` has no rewrite at all, so a 404 assertion against it
 * would prove nothing. */

const ASET = [
  "/thermal/logo-thermal-256-threshold.png",
  "/thermal/logo-thermal-320-threshold.png",
  "/favicon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-180.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

test.describe("aset statis", () => {
  for (const path of ASET) {
    test(`${path} ada di build dan berupa gambar`, async ({ page }) => {
      const res = await page.request.get(path);
      expect(res.status(), `${path} tidak ada di hasil build`).toBe(200);
      expect(
        res.headers()["content-type"],
        `${path} bukan tipe gambar — mungkin tidak ikut ter-build`,
      ).toMatch(/image\//);
    });
  }

  test("logo struk benar-benar dimuat, bukan ikon gambar rusak", async ({ page }) => {
    await pakaiSupabasePalsu(page);
    /* /pengaturan, not /kasir: this page always renders the sample receipt,
       while the cashier preview only appears after a sale is rung up. */
    await page.goto("/pengaturan");
    await page.waitForLoadState("networkidle");

    /* The receipt preview lives in a sandboxed srcdoc iframe, and
       `naturalWidth` is the only way to tell a decoded image from a broken
       one. A visual assertion cannot see inside the frame. */
    const logo = page.frameLocator('iframe[title="Pratinjau struk"]').locator("img.receipt-logo");
    await logo.waitFor({ state: "attached", timeout: 15_000 });

    const rusak = await logo.evaluate((el) => {
      const img = el as HTMLImageElement;
      return { complete: img.complete, width: img.naturalWidth };
    });
    expect(rusak.complete, "gambar logo tidak selesai dimuat").toBe(true);
    expect(
      rusak.width,
      "naturalWidth 0 berarti logo gagal decode — kemungkinan besar dapat HTML, bukan PNG",
    ).toBeGreaterThan(0);
  });

  test("manifest PWA disajikan sebagai JSON, bukan HTML", async ({ page }) => {
    /* The launcher fetches this by path. A rewritten manifest is still valid
       HTTP 200, so the browser keeps offering to install the app and the
       home-screen icon falls back to a generic glyph with nothing to report. */
    const res = await page.request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/json|manifest/);

    const isi = (await res.json()) as { name?: string; icons?: unknown[] };
    expect(isi.name).toBe("Shanti Kasir");
    expect(Array.isArray(isi.icons) && isi.icons.length).toBeTruthy();
  });

  test("halaman dalam tetap ditulis rewrite, hard refresh tidak 404", async ({ page }) => {
    await pakaiSupabasePalsu(page);
    for (const route of ["/kasir", "/customer", "/piutang"]) {
      const res = await page.goto(route);
      expect(res?.status(), `${route} dibalas 404 — rewrite SPA belum ada`).toBe(200);
      await expect(page.getByRole("button", { name: "Transaksi Baru" })).toBeVisible();
    }
  });
});
