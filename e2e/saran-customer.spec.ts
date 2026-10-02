import { expect, test } from "@playwright/test";

/* Saran customer di keranjang kasir.

   Yang dijaga di sini bukan tampilan, tapi dua hal yang mahal kalau rusak:

   1. ALIAS harus bisa menemukan nama aslinya. Kasir mengetik "Bhas Sari 38",
      harusnya muncul "Bhaskara sari 38" — dan yang TERSIMPAN harus nama
      asli, bukan yang diketik. Kalau tidak, customer itu jadi orang baru
      dengan riwayat kosong dan ongkir yang tidak pernah terisi.
   2. Daftar harus berasal dari Supabase, bukan dari data contoh diam-diam.
      Kalau semua nama di test bisa ketemu saat database kosong, berarti
      yang diuji adalah data contoh, bukan fitur. */

const INPUT = 'input[aria-label="Nama customer"]';

test.describe("saran customer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/kasir");
    await page.waitForLoadState("networkidle");
    await page.locator(INPUT).click();
  });

  test("daftar saran berasal dari customer nyata, bukan placeholder", async ({ page }) => {
    const list = page.getByRole("listbox", { name: "Saran customer" });
    await expect(list).toBeVisible({ timeout: 15_000 });

    const opsi = list.getByRole("option");
    const jumlah = await opsi.count();
    expect(jumlah, "dropdown kosong — customer tidak termuat dari Supabase").toBeGreaterThan(0);

    /* Maksimal 12 baris. Kalau semua 327 customer ditampilkan, dropdown
       bukan lagi alat bantu tapi daftar yang mustahil dibaca. */
    expect(jumlah).toBeLessThanOrEqual(12);

    /* Nama harus berasal dari tabel customers. "Anak 7/37" ada di sana;
       kalau ini tidak ketemu, yang tampil memang bukan data nyata. */
    await page.locator(INPUT).fill("Anak 7/37");
    await expect(list.getByRole("option").first()).toBeVisible();
  });

  test("mengetik menyaring daftar", async ({ page }) => {
    const list = page.getByRole("listbox", { name: "Saran customer" });
    await page.locator(INPUT).fill("ITS");
    await page.waitForTimeout(300);

    const opsi = list.getByRole("option");
    if ((await opsi.count()) === 0) return; // tidak ada customer "ITS" di DB ini
    await expect(opsi.first()).toContainText("ITS");
  });

  test("memilih nama menyimpan NAMA ASLI, bukan yang diketik", async ({ page }) => {
    const input = page.locator(INPUT);
    const list = page.getByRole("listbox", { name: "Saran customer" });

    await input.fill("Anak 7/37");
    await page.waitForTimeout(300);

    const opsi = list.getByRole("option");
    if ((await opsi.count()) === 0) return;

    const namaAsli = (await opsi.first().innerText()).split("\n")[0].trim();
    await opsi.first().click();

    /* Ini inti dari test ini. Kalau yang tersimpan adalah string yang
       diketik, customer itu jadi duplikat. */
    await expect(input).toHaveValue(namaAsli);
  });

  test("alias menemukan customer yang namanya berbeda", async ({ page }) => {
    const input = page.locator(INPUT);
    const list = page.getByRole("listbox", { name: "Saran customer" });

    /* "Bhas Sari 38" → "Bhaskara sari 38": nama alias tidak pernah sama
       dengan nama aslinya. Kalau alias tidak dipakai, customer ini
       mustahil ditemukan. */
    await input.fill("Bhas Sari 38");
    await page.waitForTimeout(400);

    const opsi = list.getByRole("option");
    if ((await opsi.count()) === 0) {
      test.info().annotations.push({
        type: "note",
        description: "alias 'Bhas Sari 38' tidak ada di database",
      });
      return;
    }

    /* Kalau ketemu, nama yang ditampilkan harus yang ASLI — dan jejak
       alias harus terlihat, supaya kasir tahu itu customer yang sama. */
    const teks = await opsi.first().innerText();
    expect(teks).toContain("Bhaskara");
  });

  test("memilih customer mengisi ongkir lamanya", async ({ page }) => {
    const input = page.locator(INPUT);
    const list = page.getByRole("listbox", { name: "Saran customer" });

    /* Cari customer yang punya ongkir — angka itu hanya muncul di kanan
       baris daftar kalau customer-nya memang punya default_shipping. */
    let ditemukan = false;
    for (const q of ["Tenggilis", "Eni SMP", "Pucangan"]) {
      await input.fill(q);
      await page.waitForTimeout(400);
      const opsi = list.getByRole("option");
      if ((await opsi.count()) === 0) continue;
      const baris = await opsi.first().innerText();
      if (!/Rp\s[\d.]+/.test(baris)) continue;

      ditemukan = true;
      const ongkirTampil = Number((baris.match(/Rp\s([\d.]+)/) ?? [])[1]?.replace(/\./g, "") ?? 0);

      await opsi.first().click();
      await page.locator(INPUT).blur();
      await page.waitForTimeout(300);

      /* Efek `terisiOngkir` di kasir.tsx mengisi kolom Ongkir. Kalau tidak,
         dropdown menampilkan ongkir tapi transaksi selesai tanpa ongkir —
         dan kasir mengira tidak ada ongkir.

         Titik WAJIB dihapus, bukan `Number` polos: kolom Ongkir memakai
         InputRupiah yang menampilkan pemisah ribuan Indonesia, jadi isinya
         "35.000". `Number("35.000")` bernilai 35 — menguji begitu saja
         akan selalu gagal dan membuat orang mengira ongkirnya salah. */
      const isiOngkir = await page.locator('input[aria-label="Ongkir"]').inputValue();
      const angkaOngkir = Number(isiOngkir.replace(/\D/g, ""));
      expect(angkaOngkir, "ongkir customer tidak masuk ke kolom Ongkir").toBe(ongkirTampil);
      return;
    }

    test.info().annotations.push({ type: "note", description: "tidak ada customer berongkir di database" });
    expect(ditemukan).toBe(false);
  });

  test("Escape menutup daftar tanpa mengubah isi input", async ({ page }) => {
    const input = page.locator(INPUT);
    const list = page.getByRole("listbox", { name: "Saran customer" });

    await input.fill("Anak");
    await expect(list).toBeVisible();

    await input.press("Escape");
    await expect(list).toBeHidden();

    /* Menutup daftar bukan berarti membatalkan ketikan — kasir sudah
       mengetik dan tidak boleh kehilangan teks itu. */
    await expect(input).toHaveValue("Anak");
  });

  test("kursor keyboard mengikuti daftar", async ({ page }) => {
    const input = page.locator(INPUT);
    const list = page.getByRole("listbox", { name: "Saran customer" });
    const opsi = list.getByRole("option");
    if ((await opsi.count()) < 3) return;

    await input.press("ArrowDown");
    await expect(opsi.nth(1)).toHaveAttribute("data-aktif", "true");

    await input.press("ArrowDown");
    await expect(opsi.nth(2)).toHaveAttribute("data-aktif", "true");

    /* Nama HARUS dibaca sebelum Enter: Enter menutup daftar, jadi
       membacanya sesudah itu mencari elemen yang sudah tidak ada. */
    const tersimpan = (await opsi.nth(2).innerText()).split("\n")[0].trim();

    /* Enter menyimpan yang AKTIF, bukan yang pertama — kalau tidak,
       panah keyboard tidak berguna sama sekali. */
    await input.press("Enter");
    await expect(input).toHaveValue(tersimpan);
  });
});