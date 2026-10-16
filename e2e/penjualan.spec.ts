import { expect, test } from "@playwright/test";

import { SALE_FIXTURE, pakaiSupabasePalsu } from "./fixture-supabase";

/* Tombol "muat ulang" di header Dashboard Penjualan.

   Halaman ini yang paling lama dibiarkan terbuka di meja kasir, dan struk dari
   perangkat lain hanya muncul setelah data ditarik ulang. Sebelum ada tombol
   ini satu-satunya jalan adalah me-refresh browser — seluruh halaman, filter,
   dan posisi gulir ikut hilang. */

test("muat ulang menarik data dari server lagi", async ({ page }) => {
  await pakaiSupabasePalsu(page, { sales: [SALE_FIXTURE] });

  /* Dihitung dari request yang benar-benar keluar, bukan dari tampilan: kalau
     tombolnya cuma memutar ikonnya tanpa memanggil apa pun, halaman terlihat
     sama dan test berbasis tampilan akan tetap hijau. */
  let tarikanSales = 0;
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/sales")) tarikanSales++;
  });

  await page.goto("/penjualan");
  await page.waitForLoadState("networkidle");

  const sebelum = tarikanSales;
  expect(
    sebelum,
    "halaman tidak menarik sales sama sekali — test ini tidak menguji apa pun",
  ).toBeGreaterThan(0);

  const muatUlang = page.getByRole("button", { name: "Muat ulang data" });
  await expect(muatUlang, "tombol muat ulang tidak ada di header penjualan").toBeVisible();
  await muatUlang.click();

  await expect
    .poll(() => tarikanSales, {
      message: "tombol muat ulang tidak menarik data lagi — ikonnya berputar tanpa memanggil apa pun",
    })
    .toBeGreaterThan(sebelum);
});

test("muat ulang duduk di sebelah kiri Export CSV", async ({ page }) => {
  await pakaiSupabasePalsu(page, { sales: [SALE_FIXTURE] });
  await page.goto("/penjualan");
  await page.waitForLoadState("networkidle");

  const muat = await page.getByRole("button", { name: "Muat ulang data" }).boundingBox();
  const ekspor = await page.getByRole("button", { name: "Export CSV" }).boundingBox();
  if (!muat || !ekspor) throw new Error("tombol tidak punya kotak");

  expect(
    muat.x + muat.width,
    "tombol muat ulang tidak di sebelah kiri Export CSV",
  ).toBeLessThanOrEqual(ekspor.x);

  /* Satu baris, bukan bertumpuk: keduanya kendali header yang dibaca
     bersamaan. */
  expect(
    Math.abs(muat.y + muat.height / 2 - (ekspor.y + ekspor.height / 2)),
    "muat ulang dan Export CSV tidak sebaris",
  ).toBeLessThan(4);
});

