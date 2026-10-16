import { describe, expect, it } from "vitest";

import { AWALAN_TAG, inferTagArea, tagDariAlias } from "./tag-area";

/* Aturan ini disalin dari `infer_customer_address_tag` di
   update_customers_csv.py. Tes ini mengunci supaya port ke JavaScript tidak
   diam-diam berbeda dari aslinya: kalau differensinya muncul di sini, yang
   perlu diperbaiki adalah salah satu dari dua salinan itu, dan keputusan
   itu harus terlihat. */

describe("inferTagArea", () => {
  it("menangkap kata area yang eksplisit di nama", () => {
    expect(inferTagArea("Sutorejo Tengah 12/10")).toBe("Sutorejo");
    expect(inferTagArea("Mulyosari Utara 11/58")).toBe("Mulyosari");
    expect(inferTagArea("BPD B 34-35")).toBe("BPD");
    expect(inferTagArea("Wisper Tengah 9/JJ-37")).toBe("Wisper");
    expect(inferTagArea("Pakuwon Harbor")).toBe("Pakuwon");
    expect(inferTagArea("Bhaskara 1 No 21")).toBe("Bhaskara");
  });

  it("menangkap singkatan area yang sering diketik", () => {
    /* Ini bentuk yang benar-benar ada di nama pelanggan, bukan bentuk
       ideal. Kalau hanya nama lengkap yang dikenali, separuh nama di
       database tidak akan punya area. */
    expect(inferTagArea("SutTgh 13/45")).toBe("Sutorejo");
    expect(inferTagArea("MulyTng 6/5")).toBe("Mulyosari");
    expect(inferTagArea("MulyUt 9/4")).toBe("Mulyosari");
    expect(inferTagArea("Bhas 7/17")).toBe("Bhaskara");
  });

  it("tidak tersesat: spasi dihapus sebelum dicocokkan", () => {
    /* Bentuk dengan spasi menempel tidak akan pernah cocok kalau hanya
       teks berspasi yang diperiksa: "SutTgh" != "Sutorejo". Bentuk padat
       itulah yang membuat aturannya bekerja. */
    expect(inferTagArea("SutTgh")).toBe("Sutorejo");
    expect(inferTagArea("SutorejoTgh")).toBe("Sutorejo");
  });

  it("area spesifik menang atas yang umum", () => {
    /* "Pantai Mentari" ada di daftar Kenjeran dan kata "Pantai" juga
       ada di sana, tapi tidak boleh ada area lain yang lebih umum yang
       mencuri lebih dulu. */
    expect(inferTagArea("Pantai Mentari 3")).toBe("Kenjeran");
  });

  it("GOJEK menang atas semua", () => {
    /* "GOJEK" bisa muncul di nama yang juga memuat kata area lain, dan
       kurirnya memang GOJEK — bukan hasil tebakan area. */
    expect(inferTagArea("Rumah GOJEK")).toBe("GOJEK");
    expect(inferTagArea("Paket GOJEK")).toBe("GOJEK");
  });

  it("menangkap kata departemen ITS", () => {
    /* Kata-kata ini tidak pernah menjadi nama area, tapi menandai
       mahasiswa atau dosen ITS. Tanpa ini, order mereka tidak masuk ke
       area mana pun dan kurirnya salah. */
    expect(inferTagArea("DPTSI Fingerprint")).toBe("ITS");
    expect(inferTagArea("Anis BRIN")).toBe("ITS");
    expect(inferTagArea("Fisika")).toBe("ITS");
    expect(inferTagArea("Perpustakaan")).toBe("ITS");
  });

  it("menangkap pola blok", () => {
    expect(inferTagArea("ITS W 6")).toBe("ITS");
    expect(inferTagArea("ITS T 73")).toBe("ITS");
    expect(inferTagArea("W 6")).toBe("ITS");
    expect(inferTagArea("D 23")).toBe("ITS");
    expect(inferTagArea("T 4")).toBe("ITS");
  });

  it("menangkap blok yang ditulis dengan kata 'No' atau garis miring", () => {
    /* Bentuk yang benar-benar dipakai pelanggan. "Blok V No 9" dan
       "P / 7" dulu tampil tanpa area: kata "No" memutus pola huruf-angka,
       dan huruf P tidak ada di daftar blok — padahal keduanya blok ITS.
       Dua-duanya di data nyata pernah masuk sebagai struk tanpa kurir. */
    expect(inferTagArea("Blok V No 9")).toBe("ITS");
    expect(inferTagArea("P / 7")).toBe("ITS");
    expect(inferTagArea("Blok T Nomor 12")).toBe("ITS");
  });

  it("blok diperiksa belakangan, jadi BPD tidak tertangkap sebagai blok", () => {
    /* "BPD B 34-35" adalah BPD. Kalau pola blok diperiksa lebih dulu,
       "B 34" akan tertangkap dan struk masuk ke area yang salah —
       termasuk salah kurir. */
    expect(inferTagArea("BPD B 34-35")).toBe("BPD");
    expect(inferTagArea("BPD")).toBe("BPD");
  });

  it("membaca alias, bukan cuma nama", () => {
    /* Kasus yang membuat bug ini ketahuan: "Anis BTH" tidak memuat kata
       area sama sekali. Tag-nya hanya terlihat dari alias `ANIS BRIN`. */
    expect(inferTagArea("Anis BTH", ["ANIS BRIN"])).toBe("ITS");
    expect(inferTagArea("Anis BTH")).toBe("");
  });

  it("nama yang tidak ada jejaknya mengembalikan string kosong", () => {
    /* Kosong berarti "tidak diketahui", bukan berarti customer ini tidak
       punya area. Peta tag di UI memakai itu untuk menampilkan tanda
       hubung, jadi mengembalikan null atau undefined di sini akan
       membuat kolom Tag tampil kosong tanpa penjelasan. */
    expect(inferTagArea("Inayati")).toBe("");
    expect(inferTagArea("")).toBe("");
    expect(inferTagArea("", ["", "  "])).toBe("");
  });
});

describe("tagDariAlias", () => {
  it("membaca tag yang disimpan sebagai alias", () => {
    /* Kolom `customers.tag` tidak selalu terisi; sebagian tag disimpan
       di `customer_aliases` dengan awalan ini. Tanpa membacanya, tag itu
       hilang dari app walau parser mengetahuinya. */
    expect(tagDariAlias([`${AWALAN_TAG}ITS`])).toBe("ITS");
    expect(tagDariAlias([`${AWALAN_TAG}Sutorejo`])).toBe("Sutorejo");
  });

  it("mengabaikan alias biasa", () => {
    expect(tagDariAlias(["ANIS BRIN", "Anis BTH"])).toBeUndefined();
    expect(tagDariAlias([])).toBeUndefined();
  });

  it("mengabaikan tag yang kosong setelah awalan", () => {
    /* `tagalamat:` tanpa isi akan menjadi tag string kosong, yang
       roundabout membuat kolom Tag menampilkan sel kosong — persis
       tampilan yang seharusnya dihindari. */
    expect(tagDariAlias([AWALAN_TAG])).toBeUndefined();
    expect(tagDariAlias([`${AWALAN_TAG}   `])).toBeUndefined();
  });

  it("tidak_case_sensitive untuk awalannya", () => {
    /* Data berasal dari import dan input manual, jadi huruf besar
       "TAGALAMAT:ITS" akan muncul. */
    expect(tagDariAlias(["tagalamat:ITS"])).toBe("ITS");
    expect(tagDariAlias(["TaGaLaMaT:Kenjeran"])).toBe("Kenjeran");
  });
});