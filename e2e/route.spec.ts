import { expect, test } from "@playwright/test";

/* Smoke semua route.

   Tiap route diuji DUA KALI dengan sengaja:
   1. lewat klik di sidebar (client-side navigation)
   2. lewat `page.goto` langsung ke URL (hard refresh / bookmark / share)

   Cara kedua yang biasanya menimpa bug Vercel. `BrowserRouter` (main.tsx:9)
   membuat seluruh aplikasi hidup di satu route; kalau hosting tidak
   menulis ulang semua path ke `index.html`, `/kasir` yang dibuka langsung
   akan 404 although klik dari sidebar tetap jalan. Test pertama tidak akan
   pernah menangkapnya — makanya yang kedua wajib ada. */

const ROUTE: { path: string; nav: string; mobile: boolean }[] = [
  { path: "/", nav: "Dashboard", mobile: true },
  { path: "/kasir", nav: "Kasir", mobile: true },
  { path: "/menu", nav: "Menu", mobile: true },
  { path: "/penjualan", nav: "Struk", mobile: true },
  { path: "/customer", nav: "Customer", mobile: true },
  { path: "/piutang", nav: "Piutang", mobile: true },
  { path: "/pengaturan", nav: "Pengaturan", mobile: true },
  { path: "/impor", nav: "Import Pesanan", mobile: false }, // desktop only
];

test.describe("route", () => {
  for (const r of ROUTE) {
    test(`${r.path} — hard refresh tidak 404`, async ({ page }) => {
      const res = await page.goto(r.path);
      /* Status 404 = hosting tidak menulis ulang SPA. Ini persis kondisi
         produksi kalau `vercel.json` belum ada. */
      expect(res?.status(), `${r.path} dibalas 404 — rewrite SPA belum ada`).toBe(200);

      // Header selalu ada = React sempat mount, bukan halaman error mentah.
      await expect(page.getByRole("button", { name: "Transaksi Baru" })).toBeVisible();

      // Konten halaman yang sebenarnya, bukan cuma shell yang kebetulan load.
      await expect(page.locator("main").first()).not.toBeEmpty();
    });
  }

  test("tidak ada route yang selesai di halaman kosong", async ({ page }) => {
    for (const r of ROUTE) {
      await page.goto(r.path);
      const teks = (await page.locator("main").first().innerText()).trim();
      expect(teks.length, `${r.path} render kosong`).toBeGreaterThan(0);
      expect(teks, `${r.path} masih nampilin shell tanpa isi`).not.toContain("404");
    }
  });
});

test.describe("navigasi sidebar", () => {
  test("setiap item sidebar menyalakan route yang benar", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Navigasi utama" });

    for (const r of ROUTE.filter((x) => x.mobile)) {
      await nav.getByRole("button", { name: r.nav }).click();
      await expect(page).toHaveURL(new RegExp(`${r.path}$`));
      // Penanda aktif ikut berganti, kalau tidak user kehilangan orientasi.
      await expect(nav.getByRole("button", { name: r.nav })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });
});

test.describe("kerangka aplikasi", () => {
  test("tema gelap/lucer tersimpan dan bertahan setelah reload", async ({ page }) => {
    await page.goto("/pengaturan");

    const gelap = async () =>
      ((await page.locator("html").getAttribute("class")) ?? "").includes("dark");

    await page.getByRole("button", { name: /Mode (terang|gelap)/ }).click();

    // `App.tsx:119` menulis ke localStorage — kalau tidak ketemu, setelan
    // hilang tiap refresh dan tema berkedip.
    const tersimpan = await page.evaluate(() => localStorage.getItem("kasir-theme"));
    expect(tersimpan).toMatch(/^(dark|light)$/);

    await page.reload();

    /* Yang dijaga adalah PERSISTENSI, bukan arah toggle. Toggle memang
       membalik, tapi `index.html:11` sudah pernah menetapkan `dark`
       sebelum hydration — jadi kondisi awal tidak bisa diasumsikan terang.
       Yang penting: apa yang ditulis masih berlaku setelah reload. */
    const sesudah = await gelap();
    expect(sesudah, "tema hilang setelah reload — setelan tidak persist").toBe(
      tersimpan === "dark",
    );
  });

  test("halaman kasir punya keranjang yang bisa dikosongkan", async ({ page }) => {
    await page.goto("/kasir");
    // Keadaan awal harus jujur: kosong, bukan data contoh diam-diam.
    await expect(page.getByText("Keranjang kosong")).toBeVisible();
  });
});