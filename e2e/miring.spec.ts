import { expect, test } from "@playwright/test";

import {
  ALIAS_TAG_DI_ALIAS,
  CUSTOMER_TAG_DI_ALIAS,
  SALE_FIXTURE,
  SALE_NAMA_PANJANG,
  SALE_TANPA_TAG,
  SALE_TAG_DI_ALIAS,
  pakaiSupabasePalsu,
} from "./fixture-supabase";

/* Tanda yang dipakai penjualan.tsx untuk struk tanpa area. Disalin di sini
   karena tes tidak boleh mengimpor konstanta dari halaman: kalau tandanya
   berubah, tes harus ikut gagal, bukan diam-diam menyalin nilai baru. */
const TANPA_TAG_TAMPIL = "—";

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

  /* Tag area dibaca dari `customers`, bukan dari `sales`. Kalau
     pemetaannya tidak sengaja ikut ke Detail Struk, tabelnya tetap
     benar dan hanya kehilangan satu kolom — persis jenis kesalahan yang
     lolos dari pemeriksaan manual. */
  test("kolom Tag ada, dan menandai struk yang tidak punya area", async ({ page }) => {
    /* Empat struk: satu tag-nya di kolom, tiga hanya di alias, satu tidak
       punya area sama sekali. */
    await pakaiSupabasePalsu(page, {
      sales: [SALE_FIXTURE, ...SALE_TAG_DI_ALIAS, SALE_TANPA_TAG],
      customers: CUSTOMER_TAG_DI_ALIAS,
      customer_aliases: ALIAS_TAG_DI_ALIAS,
    });
    /* Lebar tabel desktop (lg = 1024px). Di bawah itu tabel disembunyikan
       dan diganti daftar kartu, jadi header kolomnya memang tidak ada
       di DOM — bukan bug. Tes ini memeriksa tabel, jadi lebarnya
       disetel ke lebar yang menampilkannya. */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/penjualan");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("columnheader", { name: /Tag/ }),
      "kolom Tag tidak ada di header Detail Struk",
    ).toBeVisible();

    /* Yang diperiksa adalah bentuknya, bukan isi tag persis: nama-nama
       fixture sengaja tidak terdaftar di customers supaya tes ini tidak
       bergantung pada isi tabel itu. Yang harus berlaku: struk tanpa
       area ditandai, dan tidak ada sel yang benar-benar kosong. */
    const barisTanpaTag = page
      .locator("tbody tr")
      .filter({ hasText: SALE_TANPA_TAG.customer_name })
      .first();
    await expect(barisTanpaTag, "struk tanpa tag tidak muncul di tabel").toBeVisible();
    await expect(
      barisTanpaTag,
      "struk tanpa area tampil kosong — harus ditandai, supaya tidak terbaca seperti tabel yang gagal dimuat",
    ).toContainText(TANPA_TAG_TAMPIL);

    /* REGRESI (6 Okt 2026): ketiga struk ini tampil tanpa area padahal
       `customers.tag` kosong dan tag-nya `ITS` tersimpan sebagai alias
       `tagalamat:ITS`. Bentuknya berbeda-beda dan semuanya harus
       tertangani:

       - "Anis BTH": nama dan alias biasa tidak memuat kata area
         (`ANIS BRIN` tetap tidak dikenali sebagai area).
       - "Manajemen Bisnis Ayu": ejaan di customers kurang 'e', jadi
         cocok persis gagal; kata "ITS"-nya ada di alias
         `Gedung FKK ITS Lt 2`.
       - "Inayati": tidak ada kata area di nama maupun alias biasa.

       Kalau kolom Tag hanya membaca kolom `customers.tag`, ketiganya
       tampil kosong — dan rekap ongkir per kurir menghitung struk yang
       seharusnya ikut. */
    for (const s of SALE_TAG_DI_ALIAS) {
      const baris = page.locator("tbody tr").filter({ hasText: s.receipt_no }).first();
      await expect(baris, `struk ${s.receipt_no} tidak muncul di tabel`).toBeVisible();
      await expect(
        baris,
        `${s.customer_name} tampil tanpa area — tag-nya tersimpan di alias, bukan di kolom customers.tag`,
      ).toContainText("ITS");
    }
  });

  /* Tag ikut dicari karena area = satu kurir. Kasir lebih sering
     bertanya "semua kiriman Sutorejo" daripada menyebut nama per struk,
     dan tanpa ini dia harus membaca satu per satu baris untuk
     mengumpulkan struk satu kurir. */
  test("pencarian menemukan struk berdasarkan tag area", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await pakaiSupabasePalsu(page, {
      sales: [SALE_FIXTURE, ...SALE_TAG_DI_ALIAS, SALE_TANPA_TAG],
      customers: CUSTOMER_TAG_DI_ALIAS,
      customer_aliases: ALIAS_TAG_DI_ALIAS,
    });
    await page.goto("/penjualan");
    await page.waitForLoadState("networkidle");

    const cari = page.getByPlaceholder("Cari no struk atau customer...");
    /* Hanya baris data. Tabel juga merender satu baris untuk keadaan
       kosong (selnya `colSpan`), jadi `tbody tr` biasa ikut terhitung
       dan assertion "nol hasil" akan selalu gagal — bukan karena
       pencariannya salah. */
    const baris = page.locator("tbody tr:not(:has(td[colspan]))");

    /* Pencarian lowercase harusnya tetap menemukan tag yang kapital:
       "its" adalah yang diketik, "ITS" yang tersimpan.

       Tiga, bukan empat: `SALE_FIXTURE` memakai customer yang tidak ada
       di `customers`, jadi areanya kosong dan tidak boleh ikut tertangkap
       hanya karena kata "its" muncul di alamat yang lain. */
    await cari.fill("its");
    await expect(baris, "mengetik 'its' tidak menemukan struk berarea ITS").toHaveCount(
      SALE_TAG_DI_ALIAS.length,
    );
    await expect(baris.first()).toContainText("ITS");

    await cari.fill("tagalamat");
    await expect(
      baris,
      "mengetik tag ikut tercocokkan — 'tagalamat' bukan teks yang dicari kasir",
    ).toHaveCount(0);

    /* Area yang tidak ada di data ini harus mengembalikan kosong, bukan
       semua baris — kalau tidak, placeholder "Tidak ada struk yang
       cocok" akan hilang padahal tidak ada yang cocok. */
    await cari.fill("supit");
    await expect(
      baris,
      "mencari area yang tidak ada tidak boleh menampilkan baris lain",
    ).toHaveCount(0);
    /* Keadaan kosong dirender dua kali — tabel dan daftar kartu — jadi
       teksnya perlu discope ke tabel. Tanpa itu, strict mode gagal
       dengan dua kandidat dan tes-nya tidak pernah hijau. */
    await expect(page.locator("tbody").getByText(/Tidak ada struk yang cocok/)).toBeVisible();
  });

  test("tag di layar sempit ikut tampil, dan ditandai bila tidak ada", async ({ page }) => {
    /* Kolom tabel tidak ada di bawah lg, jadi daftar kartu yang harus
       membawa tag juga. Kalau hanya tabelnya yang dapat, information
       area hilang tepat di layar kasir yang paling sering dipakai. */
    await page.setViewportSize({ width: 390, height: 900 });
    await pakaiSupabasePalsu(page, { sales: [SALE_FIXTURE, SALE_TANPA_TAG] });
    await page.goto("/penjualan");
    await page.waitForLoadState("networkidle");

    const kartuTanpaTag = page
      .locator("ul.lg\\:hidden li > div")
      .filter({ hasText: SALE_TANPA_TAG.customer_name })
      .first();
    await expect(kartuTanpaTag, "struk tanpa tag tidak muncul di daftar kartu").toBeVisible();
    await expect(kartuTanpaTag, "tag tidak ikut ke daftar kartu di layar sempit").toContainText(
      TANPA_TAG_TAMPIL,
    );
  });

  test("tooltip teks penuh muncul saat kursor di atas nama yang terpotong", async ({ page }) => {
    /* Atribut `title` bawaan browser tidak bisa diuji seperti ini: ia
       tidak pernah masuk ke DOM, muncul setelah jeda, dan posisinya
       dikendalikan sistem operasi. Tooltip di aplikasi ini elemen
       sungguhan, jadi harus bisa ditemukan dan dibaca. */
    await pakaiSupabasePalsu(page, {
      sales: [{ ...SALE_FIXTURE, customer_name: SALE_NAMA_PANJANG }],
    });
    /* Lebar tabel desktop. Di bawah lg nama customer tidak pernah
       terpotong, jadi tidak ada yang perlu tooltip dan tes ini akan
       mengukur halaman yang memang tidak salah. */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/penjualan");
    await page.waitForLoadState("networkidle");

    /* Di dalam tabel saja. Nama yang sama juga dirender di daftar kartu
       (yang tersembunyi di lebar ini), jadi `getByText` tanpa batas
       akan mengambil yang mana saja yang kebetulan lebih dulu. */
    const nama = page.locator("tbody").getByText(SALE_NAMA_PANJANG).first();
    await expect(nama).toBeVisible();
    /* Aturan dari komponen: `title` tidak boleh dipasang. Kalau
       dikembalikan, tooltip hilang dan test ini gagal dengan pesan
       yang menyebut alasannya. */
    await expect(nama, "elemen memakai atribut title, bukan komponen tooltip").not.toHaveAttribute(
      "title",
    );

    await nama.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip, "hover tidak memunculkan tooltip teks penuh").toBeVisible();
    await expect(tip).toHaveText(SALE_NAMA_PANJANG);

    /* Tooltip harus keluar dari wadah tabel. Tabel memakai
       overflow-x-auto; tooltip yang ikut terpotong di dalamnya membuat
       kasir tidak pernah melihat teks yang dicari. */
    const diDalamWadah = await tip.evaluate((el) => {
      let n: HTMLElement | null = el.parentElement;
      while (n) {
        if (n.tagName === "TABLE" || n.classList.contains("overflow-x-auto")) return true;
        n = n.parentElement;
      }
      return false;
    });
    expect(diDalamWadah, "tooltip dirender di dalam wadah yang memotong isinya").toBe(false);
  });

  /* 320px adalah iPhone SE 1st gen — masih dipakai kasir yang HP-nya
     kecil. Di lebar ini label waktu penuh ("6 Oktober 2026, 09:49")
     melebihi lebar baris dan terpotong jadi "6 Okt...", sehingga
     tanggal hilang justru di layar yang paling sempit. */
  test("kartu struk tidak meluber dan tanggalnya utuh di 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    /* Satu struk di fixture. Tanpa ini daftar kartu kosong dan test-nya
       mengukur halaman kosong — hijau tanpa menguji apa pun. */
    await pakaiSupabasePalsu(page, { sales: [SALE_FIXTURE] });
    await page.goto("/penjualan");
    await page.waitForLoadState("networkidle");

    /* Fixture hanya punya satu struk. Satu sudah cukup: yang diperiksa
       adalah lebarnya, bukan banyaknya. */
    const kartu = page.locator("ul.lg\\:hidden li > div").first();
    await expect(
      kartu,
      "kartu struk tidak muncul di layar sempit — daftar kartu hilang, tabel masih ada",
    ).toBeVisible();

    /* Element-level check, bukan scrollWidth dokumen: dokumen yang
       meluber bisa dipaksa menggulir horizontal, dan kasir tidak akan
       pernah kegeser-kiri untuk mencari aksi di kanan kartu. */
    const { cardRight, viewport } = await kartu.evaluate((el) => ({
      cardRight: el.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth,
    }));
    expect(
      cardRight,
      "kartu struk meluber keluar layar — tombol Hapus jadi tidak bisa ditekan",
    ).toBeLessThanOrEqual(viewport + 1);

    /* Tanggal harus tampil utuh, bukan terpotong dengan ellipsis.
       toBeVisible + teks yang bukan terpotong: kalau nama bulan
       kembali jadi penuh, teks aslinya masih ada di DOM meski
       terpotong visual, jadi yang diperiksa adalah teks yang benar-benar
       dirender lewat scrollWidth vs clientWidth. */
    const waktu = kartu.locator("span.figure").last();
    const waktuRingkas = await waktu.evaluate((el) => ({
      teks: el.textContent ?? "",
      truncated: el.scrollWidth > el.clientWidth + 1,
    }));
    expect(
      waktuRingkas.teks,
      "label waktu yang muncul bukan bentuk ringkas — di 320px label penuh terpotong",
    ).toMatch(/^\d{1,2} [A-Za-z]{3} \d{2}:\d{2}$/);
    expect(
      waktuRingkas.truncated,
      `waktu "${waktuRingkas.teks}" terpotong — tanggal tidak terbaca`,
    ).toBe(false);
  });
});