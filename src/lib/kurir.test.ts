import { describe, expect, it } from "vitest";

import { grupPerKurir, kurirDariTag, petaTag, rekapOngkirPerKurir, TAG_TANPA_PEMETAAN } from "./kurir";

/* Pemetaan kurir diambil dari script.js lama. Test ini mengunci supaya
   perpindahan tag diam-diam tidak mengubah laporan ongkir. */

describe("kurirDariTag", () => {
  it("memetakan tag area ke kurir", () => {
    expect(kurirDariTag("ITS")).toBe("Hide/Vendi");
    expect(kurirDariTag("Sutorejo")).toBe("Yanto");
    expect(kurirDariTag("Mulyosari")).toBe("Yanto");
    expect(kurirDariTag("Bhaskara")).toBe("Sudes");
    expect(kurirDariTag("Pantai Mentari")).toBe("Sudes");
    expect(kurirDariTag("GOJEK")).toBe("GOJEK");
  });

  it("abai spasi dan huruf besar", () => {
    expect(kurirDariTag("  sutorejo  ")).toBe("Yanto");
    expect(kurirDariTag("gojek")).toBe("GOJEK");
  });

  it("tag tak dikenal tidak dipaksa jadi kurir", () => {
    expect(kurirDariTag("Rumah")).toBe("");
    expect(kurirDariTag("")).toBe("");
    expect(kurirDariTag(null)).toBe("");
  });
});

describe("petaTag", () => {
  const cari = petaTag([
    { name: "Bhaskara 7/17", tag: "Bhaskara" },
    { name: "Budi Santoso", tag: "Sutorejo" },
    { name: "Tanpa Tag", tag: null },
  ]);

  it("cocok persis", () => {
    expect(cari("Budi Santoso")).toBe("Sutorejo");
    expect(cari("budi  santoso")).toBe("Sutorejo");
  });

  it("cocok walau nama di struk disingkat", () => {
    expect(cari("Bhaskara 7/17")).toBe("Bhaskara");
    expect(cari("Bhaskara III")).toBe("Bhaskara");
  });

  it("tebak dari kata area di nama kalau pelanggan tidak dikenal", () => {
    expect(cari("Pak Rudi GOJEK")).toBe("GOJEK");
    expect(cari("Ibu Tanti Sutorejo")).toBe("Sutorejo");
  });

  it("nama tanpa jejak area mengembalikan string kosong, bukan undefined", () => {
    /* Kolom Tag menampilkan tanda hubung kalau hasilnya kosong. Kalau
       fungsi ini mengembalikan undefined, `s.tag === ""` tidak akan
       pernah benar dan baris tanpa tag akan tampil kosong — bukan
       ditandai, tapi kelihatan seperti tabel yang gagal dimuat. */
    expect(cari("Sari Rina")).toBe("");
    expect(cari("")).toBe("");
  });

  /* Bug yang ditemukan 6 Okt 2026: kolom Tag menampilkan tanda hubung
     untuk "Anis BTH", padahal area-nya jelas ITS. */
  it("membaca tag yang tersimpan di alias, bukan hanya di kolom tag", () => {
    /* Kolom `customers.tag` tidak selalu terisi. Sebagian tag disimpan di
       `customer_aliases` berawalan `tagalamat:` — dan "Anis BTH" tidak
       memuat satu pun kata area, jadi tanpa alias-nya tag tidak akan
       pernah ditemukan. Kolom Tag akan kosong, dan rekap ongkir per
       kurir menghitung struk yang seharusnya ikut. */
    const cariAlias = petaTag(
      [{ id: "c126", name: "Anis BTH", tag: null }],
      [{ customer_id: 126, alias: "ANIS BRIN" }],
    );
    expect(cariAlias("Anis BTH")).toBe("ITS");
  });

  it("kolom tag menang atas alias ketika keduanya ada dan berbeda", () => {
    /* Kolom `tag` yang di-maintenance manual harus jadi acuan. Kalau
       alias menang, memperbaiki tag di database tidak akan mengubah
       apa pun yang tampil — dan yang salah ikut tersembunyi. */
    const kedua = petaTag(
      [{ id: "c1", name: "Sari", tag: "Sutorejo" }],
      [{ customer_id: 1, alias: "tagalamat:GOJEK" }],
    );
    expect(kedua("Sari")).toBe("Sutorejo");
  });

  it("meneza tag dari nama customer yang tidak punya tag maupun alias", () => {
    /* Baris customers tanpa tag dan tanpa alias `tagalamat:` masih
       boleh punya area yang bisa dibaca dari namanya. Lebih baik
       daripada kosong, selama tidak ada nilai tersimpan yang dilawan. */
    const tanpaTag = petaTag([{ id: "c9", name: "Mulyosari Utara 11/58", tag: null }]);
    expect(tanpaTag("Mulyosari Utara 11/58")).toBe("Mulyosari");
  });

  it("nama customer yang tidak ada di peta tetap di-inferensi", () => {
    /* Struk lama memakai nama yang sudah diganti, dan kasir sering
       menyingkat. Nama itu tidak ada di peta, tapi aturannya masih
       berlaku — lebih baik daripada tanda hubung. */
    const cari = petaTag([{ id: "c1", name: "Budi", tag: "Sutorejo" }]);
    expect(cari("ITS W 6")).toBe("ITS");
    expect(cari("Sutorejo Tengah 12/10")).toBe("Sutorejo");
  });

  it("customer dengan tag kosong dianggap tidak punya tag", () => {
    /* Kolom tag di database boleh kosong. Baris seperti itu harus
       diperlakukan sama dengan pelanggan yang tidak ada sama sekali. */
    const cariKosong = petaTag([
      { name: "Tanpa Tag", tag: null },
      { name: "Tag Kosong", tag: "   " },
    ]);
    expect(cariKosong("Tanpa Tag")).toBe("");
    expect(cariKosong("Tag Kosong")).toBe("");
  });

  it("nama yang tidak ada jejak area = kosong, bukan tebakan", () => {
    expect(cari("Budi")).toBe("");
    expect(cari("Tanpa Tag")).toBe("");
  });
});

describe("rekapOngkirPerKurir", () => {
  const tag = petaTag([
    { name: "Budi", tag: "Sutorejo" },
    { name: "Rina", tag: "GOJEK" },
    { name: "Budi", tag: "Sutorejo" },
  ]);

  const s = (ongkir: number, customerName: string, statusTerhapus = false) => ({
    ongkir,
    customerName,
    statusTerhapus,
  });

  it("mengelompokkan per kurir, urut ongkir terbesar", () => {
    const r = rekapOngkirPerKurir(
      [s(15_000, "Budi"), s(10_000, "Budi"), s(60_000, "Rina")],
      tag,
    );
    expect(r.rows.map((x) => x.kurir)).toEqual(["GOJEK", "Yanto"]);
    expect(r.rows[0]).toEqual({ kurir: "GOJEK", tag: "GOJEK", count: 1, total: 60_000 });
    expect(r.rows[1]).toEqual({ kurir: "Yanto", tag: "Sutorejo", count: 2, total: 25_000 });
    expect(r.total).toBe(85_000);
    expect(r.strukBerongkir).toBe(3);
    expect(r.tanpaTag).toBe(0);
  });

  it("struk terhapus tidak masuk", () => {
    const r = rekapOngkirPerKurir([s(15_000, "Budi", true)], tag);
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("menyebut rentang tanggalnya, bukan menebak", () => {
    const r = rekapOngkirPerKurir(
      [
        { ...s(15_000, "Budi"), tanggal: "2026-06-04T02:28:07.559Z" },
        { ...s(20_000, "Rina"), tanggal: "2026-09-30T03:35:32.019Z" },
        { ...s(5_000, "Budi"), tanggal: "bukan tanggal" },
      ],
      tag,
    );
    expect(r.rentangAwal).toBe("2026-06-04");
    expect(r.rentangAkhir).toBe("2026-09-30");
  });

  it("tanpa tag dikumpulkan, bukan dibuang diam-diam", () => {
    const r = rekapOngkirPerKurir([s(20_000, " orang tak dikenal ")], tag);
    expect(r.rows[0].kurir).toBe(TAG_TANPA_PEMETAAN);
    expect(r.tanpaTag).toBe(1);
    expect(r.total).toBe(20_000);
  });

  it("ongkir 0 tanpa tag diabaikan sepenuhnya", () => {
    const r = rekapOngkirPerKurir([s(0, " orang tak dikenal ")], tag);
    expect(r.rows).toEqual([]);
  });

  it("tanpa data = nol, bukan NaN", () => {
    expect(rekapOngkirPerKurir([], tag)).toEqual({
      rows: [],
      total: 0,
      strukBerongkir: 0,
      tanpaTag: 0,
      rentangAwal: null,
      rentangAkhir: null,
    });
  });
});

describe("grupPerKurir", () => {
  it("menggatherkan area di bawah nama kurir", () => {
    const g = grupPerKurir([
      { kurir: "Yanto", tag: "Sutorejo", count: 10, total: 100_000 },
      { kurir: "Yanto", tag: "Mulyosari", count: 5, total: 200_000 },
      { kurir: "GOJEK", tag: "GOJEK", count: 2, total: 300_000 },
    ]);
    // Total keduanya sama-sama 300.000; yang menang diurutan adalah yang
    // struknya lebih banyak, lalu nama sebagai pemutus terakhir.
    expect(g.map((x) => x.kurir)).toEqual(["Yanto", "GOJEK"]);
    expect(g[0].count).toBe(15);
    expect(g[0].total).toBe(300_000);
    // rincian dalam kurir ikut urut ongkir
    expect(g[0].areas.map((a) => a.tag)).toEqual(["Mulyosari", "Sutorejo"]);
  });

  it("kelompok tanpa tag ditandai supaya tidak disangka nama kurir", () => {
    const g = grupPerKurir([{ kurir: TAG_TANPA_PEMETAAN, tag: TAG_TANPA_PEMETAAN, count: 1, total: 10_000 }]);
    expect(g[0].belumDipetakan).toBe(true);
    expect(grupPerKurir([{ kurir: "Sudes", tag: "Bhaskara", count: 1, total: 1 }])[0].belumDipetakan).toBe(false);
  });

  it("tanpa baris = array kosong", () => {
    expect(grupPerKurir([])).toEqual([]);
  });
});
