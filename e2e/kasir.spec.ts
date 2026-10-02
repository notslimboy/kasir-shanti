import { expect, test } from "@playwright/test";

import { VARIAN_CUSTOM, VARIAN_PILIH, pakaiSupabasePalsu } from "./fixture-supabase";

/* Alur kasir.

   Katalog asli butuh Supabase dan Angkanya milik pelanggan sungguhan, jadi
   test ini TIDAK memakai data nyata. Sekarang data datang dari fixture di
   `fixture-supabase.ts`. Yang diuji di sini adalah mekanisme yang menjaga
   kasir dari salah input — bagian yang kalau rusak, transaksi jadi benar
   dengan cara yang salah.

   Yang dijaga:
   - keranjang benar-benar kosong di awal (bukan sisa order sebelumnya)
   - tombol bayar mati saat keranjang kosong
   - pencarian tidak pernah menampilkan "produk" fiktif
   - kuantitas naik/turun benar-benar mengubah subtotal

   Katalog selalu ada karena fixture-nya, jadi tidak ada lagi test yang
   dilewati diam-diam. Sebelumnya katalog kosong berarti separuh test di file
   ini tidak teruji sama sekali, dan tidak ada yang tahu. */

test.beforeEach(async ({ page }) => {
  await pakaiSupabasePalsu(page);
  await page.goto("/kasir");
});

async function katalogSiap(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByPlaceholder("Cari menu atau SKU…")).toBeVisible();
  /* Dulu fungsi ini mengembalikan `false` dan test-nya di-skip kalau katalog
     kosong. Sekarang itu jadi assertion yang gagal: katalog datang dari
     fixture, jadi kosong berarti ada bug, bukan kondisi yang perlu dilewati.
     Skip di sini berarti test hijau tanpa menguji apa pun. */
  await expect(
    page.getByText(/Belum ada menu|Menu belum dimuat|Tambah menu dulu/),
    "katalog dari fixture tidak termuat — test sisanya tidak akan menguji apa pun",
  ).toHaveCount(0);
}

test("keranjang mulai kosong dan tombol bayar mati", async ({ page }) => {
  await expect(page.getByText("Keranjang kosong")).toBeVisible();

  const bayar = page.getByRole("button", { name: /^Bayar Rp/ });
  await expect(bayar).toBeDisabled();
});

test("keranjang kosong tidak diam-diam menampilkan ongkir", async ({ page }) => {
  await page.goto("/kasir");
  await expect(page.getByText("Keranjang kosong")).toBeVisible();

  /* REGRESI (bug 2 Okt 2026, kasir.tsx:43): ongkir diinisialisasi
     Rp 15.000, jadi keranjang yang masih kosong langsung menampilkan
     "Total Rp 15.000". Kasir buka aplikasi, belum nambah apa-apa,
     sudah melihat angka. Tambah satu menu → total melompat naik
     Rp 15.000 dan penyebabnya tidak terlihat di layar.

     State yang jujur untuk keranjang kosong adalah nol. Ongkir yang
     benar datang dari data customer saat namanya cocok; kalau tidak,
     kasir mengetiknya sendiri. */
  /* `exact: true` wajib: tanpa itu "Total" ikut cocok dengan "Subtotal"
     (mengandung kata yang sama) dan strict mode gagal dengan dua
     kandidat. Baris total adalah pasangan dari label "Total" — bukan
     sembarang teks yang memuat kata itu. */
  const total = page
    .locator("div", { has: page.getByText("Total", { exact: true }) })
    .last();
  await expect(total).toBeVisible();

  expect(
    (await total.innerText()).replace(/[^\d]/g, ""),
    "keranjang kosong menampilkan total bukan nol",
  ).toBe("0");
});

test("mencari menu tidak pernah memunculkan produk fiktif", async ({ page }) => {
  await katalogSiap(page);

  const cari = page.getByPlaceholder("Cari menu atau SKU…");

  // Kata yang pasti tidak ada di katalog catering. Kalau muncul kartu,
  // berarti filter bocor ke data contoh.
  await cari.fill("zzzzzzqqqqx");
  await page.waitForTimeout(300);
  await expect(page.getByText("Menu tidak ditemukan")).toBeVisible();
  await expect(page.getByText("Keranjang kosong")).toBeVisible();
});

test("tambah dan kurangi item mengubah subtotal", async ({ page }) => {
  await katalogSiap(page);

  const cari = page.getByPlaceholder("Cari menu atau SKU…");
  await cari.fill("a");
  await page.waitForTimeout(500);

  const item = page.locator("[data-cart-item]");

  await page.locator(`[data-variant-add="${VARIAN_PILIH}"]`).first().click();
  await expect(
    item.first(),
    "klik varian tidak menambah apa pun ke keranjang",
  ).toBeVisible();

  // Kuantitas 1 → 2 harus menaikkan total baris itu.
  const totalBaris = item.first().locator(".text-sm.font-bold.figure");
  const sebelum = await totalBaris.innerText();

  await item.first().getByRole("button", { name: "Tambah" }).click();
  await page.waitForTimeout(400);

  const sesudah = await totalBaris.innerText();
  const angka = (s: string) => Number(s.replace(/[^\d]/g, ""));
  expect(angka(sesudah)).toBeGreaterThan(angka(sebelum));

  // Dan tombol kurang harus mengembalikannya.
  await item.first().getByRole("button", { name: "Kurangi" }).click();
  await page.waitForTimeout(400);
  expect(angka(await totalBaris.innerText())).toBe(angka(sebelum));
});

test("kosongkan keranjang mengembalikan keadaan awal", async ({ page }) => {
  await katalogSiap(page);

  const cari = page.getByPlaceholder("Cari menu atau SKU…");
  await cari.fill("a");
  await page.waitForTimeout(500);
  const item = page.locator("[data-cart-item]");

  await page.locator(`[data-variant-add="${VARIAN_PILIH}"]`).first().click();
  await expect(item.first()).toBeVisible();

  await page.getByRole("button", { name: "Kosongkan" }).click();
  await expect(page.getByText("Keranjang kosong")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Bayar Rp/ })).toBeDisabled();
});

test("baris custom tanpa harga tidak bisa dibayar", async ({ page }) => {
  await katalogSiap(page);

  const cari = page.getByPlaceholder("Cari menu atau SKU…");
  await cari.fill("a");
  await page.waitForTimeout(500);

  /* Baris custom baru ADA kalau varian custom-nya diklik lebih dulu.
     Versi spec ini sebelumnya hanya mencari input "isi harga" tanpa
     pernah mengklik apa pun, jadi selalu kosong dan selalu di-skip —
     guard yang delighted menguji tidak ada apa pun. */
  await page.locator(`[data-variant-add="${VARIAN_CUSTOM}"]`).first().click();

  const hargaKosong = page.getByPlaceholder("isi harga");
  await expect(
    hargaKosong.first(),
    "varian custom tidak menghasilkan input harga di keranjang",
  ).toBeVisible();

  /* Two assertions instead of a click. The pay button is disabled *by
     design* here — clicking it just hangs on a permanently-disabled
     element, so the old spec hung until timeout with a message that
     explained nothing. What matters is the guard, not the click. */
  const bayar = page.getByRole("button", { name: "Isi harga custom dulu" });
  await expect(
    bayar,
    "tombol bayar tidak berubah jadi 'Isi harga custom dulu' — transaksi tanpa harga bisa diselesaikan",
  ).toBeDisabled();
});

test("nominal uang diformat dalam Rupiah", async ({ page }) => {
  await katalogSiap(page);

  const cari = page.getByPlaceholder("Cari menu atau SKU…");
  await cari.fill("a");
  await page.waitForTimeout(500);
  const item = page.locator("[data-cart-item]");

  await page.locator(`[data-variant-add="${VARIAN_PILIH}"]`).first().click();
  await expect(item.first()).toBeVisible();

  // Kasir Indonesia salah baca "25000" sebagai dua ratus lima ribu.
  await expect(item.first()).toContainText("Rp");
});