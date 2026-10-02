import { expect, test } from "@playwright/test";

/* Tes yang hanya jalan di proyek `mobile` (Pixel 7).

   Dua aturan tampilan yang dijaga di sini berasal dari keputusan desain,
   bukan dari tebakan: `import` dan `menu` butuh lebar — tabel 9 kolom dan
   grid katalog. Di bawah `lg`, keduanya harus memaksa balik ke Dashboard
   alih-alih menampilkan layout yang tidak mungkin dipakai. */

/* Test ignore, bukan test pass — supaya Status hijau di run berikutnya
   tidak disalahartikan sebagai "mobile sudah dijaga". */

test.describe("mobile", () => {
  test("drawer terbuka lewat tombol menu", async ({ page }) => {
    await page.goto("/");

    const buka = page.getByRole("button", { name: "Buka menu" });
    await expect(buka).toBeVisible(); // hanya di mobile
    await buka.click();

    const nav = page.getByRole("navigation", { name: "Navigasi utama" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Tutup menu" })).toBeVisible();
  });

  test("importPesanan memaksa balik ke dashboard", async ({ page }) => {
    await page.goto("/impor");

    // `DesktopOnly` (App.tsx:94) redirect ke "/". Kalau form CSV sempat
    // terlihat sekilas, itu justru bug yang jadi alasan komponen itu
    // memakai useState initializer, bukan useEffect.
    await page.waitForURL("**/", { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByText("Keranjang kosong")).toHaveCount(0);
  });

  test("sidebar utama tidak merender di layar sempit", async ({ page }) => {
    await page.goto("/");
    // Rail desktop disembunyikan lewat CSS `hidden lg:flex`.
    await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeHidden();
  });

  test("halaman kasir tetap bisa dibuka di mobile", async ({ page }) => {
    await page.goto("/kasir");
    await expect(page.getByPlaceholder("Cari menu atau SKU…")).toBeVisible();

    /* Di mobile keranjang jadi sheet, dibuka lewat tombol fixed di
       bawah (kasir.tsx:831).

       Tombol ini sempat TIDAK punya nama aksesibel — isinya cuma
       "0 item" + nominal, jadi screen reader membacanya sebagai
       "tombol, 0 item, Rp 0" dan kasir tidak tahu itu keranjang.
       Sekarang tombolnya membawa `aria-label` yang menyebut fungsinya.

       Selector memakai `getByRole` dengan pola nama, bukan selector
       longgar. Kalau `aria-label` dihapus lagi, test ini gagal —
       bukan lolos diam-diam. */
    await expect(page.getByRole("button", { name: /^Buka keranjang/ })).toBeVisible();
  });

  test("tombol sheet keranjang benar-benar membuka sheet", async ({ page }) => {
    await page.goto("/kasir");
    await page.getByRole("button", { name: /^Buka keranjang/ }).click();

    // Sheet terbuka = muncul heading "Keranjang · …" (kasir.tsx:859).
    await expect(page.getByText(/Keranjang ·/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Tutup keranjang" })).toBeVisible();
  });
});