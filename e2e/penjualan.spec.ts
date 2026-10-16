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

/* Pindah tab tanggal (Harian / Mingguan / Bulanan / Custom).

   Dulu tiap rentang menarik datanya sendiri dari server: tab yang belum
   pernah dibuka menunggu jaringan — terukur 346ms (Mingguan) dan 530ms
   (Bulanan) pada server lokal berlatensi 150ms — dan itulah yang terasa
   "tidak instan", karena tabnya menyala seketika sementara isinya menyusul.

   Yang diuji di sini bukan durasinya (angka waktu di CI selalu goyah), tapi
   sebabnya: rentang lain sudah ditarik lebih dulu, jadi pindah tab TIDAK
   mengeluarkan permintaan baru. Kalau pemanasan latar belakang itu hilang,
   jumlah permintaannya naik dan testnya gagal. */
test("tab tanggal lain sudah disiapkan sebelum diklik", async ({ page }) => {
  await pakaiSupabasePalsu(page, { sales: [SALE_FIXTURE] });

  const batasRentang = new Set<string>();
  let tarikanSales = 0;
  page.on("request", (r) => {
    if (!r.url().includes("/rest/v1/sales")) return;
    tarikanSales++;
    for (const p of new URL(r.url()).searchParams.getAll("completed_at")) batasRentang.add(p);
  });

  await page.goto("/penjualan");
  await expect(page.getByRole("heading", { name: "Dashboard Penjualan" })).toBeVisible();

  /* Tiga batas bawah yang berbeda: rentang yang sedang dilihat + tab lain
     (bulan berjalan dan "30 hari" dari kalender Custom). Pada tanggal 1,
     Bulanan sama dengan Harian sehingga yang tersisa tiga — karena itu >= 3,
     bukan angka tetap. */
  await expect
    .poll(() => batasRentang.size, {
      message: "tab lain tidak ditarik di latar belakang — pindah tab akan menunggu jaringan",
    })
    .toBeGreaterThanOrEqual(3);

  /* Menunggu SEMUA permintaan pemanasan selesai, bukan cuma keluar: kalau
     tab diklik saat pemanasan masih jalan, jumlah permintaan berikutnya
     bergantung waktu, dan testnya jadi goyah. */
  await page.waitForLoadState("networkidle");
  const sebelum = tarikanSales;

  for (const tab of ["Mingguan", "Bulanan", "Harian"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  /* Beri kesempatan permintaan yang (kalau ada bug) menyusul untuk tercatat:
     tanpa jeda ini, permintaannya bisa belum sempat keluar saat diperiksa. */
  await page.waitForTimeout(600);

  expect(
    tarikanSales - sebelum,
    "pindah tab masih menarik data dari server — padahal rentangnya sudah disiapkan",
  ).toBe(0);
});

test("memilih rentang custom menarik datanya sebelum tombol Terapkan", async ({ page }) => {
  await pakaiSupabasePalsu(page, { sales: [SALE_FIXTURE] });

  let tarikanSales = 0;
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/sales")) tarikanSales++;
  });

  await page.goto("/penjualan");
  await expect(page.getByRole("heading", { name: "Dashboard Penjualan" })).toBeVisible();

  /* Pemanasan latar belakang diselesaikan dulu; kalau tidak, yang terhitung
     di bawah bisa saja permintaan pemanasan, bukan pratinjau rentangnya. */
  await page.waitForLoadState("networkidle");
  const sebelum = tarikanSales;

  /* Dua tanggal yang tidak mungkin sama dengan preset mana pun: H-3 dan H-2.
     Rentangnya jadi 2 hari, dan itu bisa diperiksa dari chip di layar. */
  const hari = (n: number) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n).toDateString();
  };

  await page.getByRole("button", { name: "Pilih rentang tanggal" }).click();
  await page.locator(`[data-day="${hari(3)}"]`).click();
  await page.locator(`[data-day="${hari(2)}"]`).click();

  /* Jeda antara klik tanggal kedua dan "Terapkan" dipakai untuk menarik
     datanya. Diperiksa SEBELUM menekan Terapkan: kalau penarikannya baru
     mulai saat diterapkan, yang diuji di sini tidak ada. */
  await expect
    .poll(() => tarikanSales, {
      message: "rentang custom belum ditarik saat tanggal kedua dipilih — menerapkan jadi menunggu jaringan",
    })
    .toBeGreaterThan(sebelum);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page.getByRole("tab", { name: "Custom" })).toHaveAttribute("aria-selected", "true");
  /* Chip "2 hari" di baris filter — dibedakan dari angka serupa di kartu
     KOT ("Menu Terlaris (2 hari)") yang juga menampilkan jumlah hari. */
  await expect(page.locator("span.figure", { hasText: /^2 hari$/ })).toBeVisible();

  /* Rentangnya sudah ada di memori: menekan Terapkan tidak menunggu
     permintaan baru, dan penanda "memuat" tidak perlu muncul. */
  const sesudahTerapkan = tarikanSales;
  await expect(page.getByText("Memuat rentang…")).toHaveCount(0);
  expect(
    tarikanSales - sesudahTerapkan,
    "menerapkan rentang custom menarik ulang data yang sudah ditarik",
  ).toBe(0);
});
