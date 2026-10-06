import { describe, expect, it } from "vitest";

import {
  keCompletedAt,
  parsePesananCsv,
  parseTanggal,
  parseUang,
  pisahCsv,
  type CariHarga,
} from "./impor-pesanan";
import { type KandidatProduk } from "./cocok-produk";
import { halfVariantPrice } from "./pricing";
import { blockingDraft, cocokkanDraft, normalisasiSeparuh, statusDraft } from "./status-draft";

/* Format dan perilakunya harus sama dengan Bulk Input di aplikasi lama,
   supaya file yang sudah pernah dipakai (sample-bulk-orders.csv) langsung
   bisa dibuka. Yang paling penting: harga TIDAK PERNAH dikarang. */

/* sample-bulk-orders.csv milik aplikasi lama, 5 baris / 3 pesanan. */
const SAMPLE = `customer,chatDate,payment,ongkir,item,quantity,note,sendNote
"Bu Ani - Jl Melati 12","28/5/2026 10.15","Tunai",10000,"Nasi Goreng Rumahan",20,"sambal pisah untuk 5 porsi","kirim ke pos satpam"
"Bu Ani - Jl Melati 12","28/5/2026 10.15","Tunai",10000,"Nasi Goreng Seafood",5,"tidak pedas","kirim ke pos satpam"
"Pak Budi - Jl Kenanga 8","28/5/2026 12.03","Transfer",15000,"Nasi Goreng Jawa",10,"tidak pakai udang",""
"Pak Budi - Jl Kenanga 8","28/5/2026 12.03","Transfer",15000,"Nasi Goreng Kampung",8,"pedas sedang",""
"Mbak Rina - Perum Griya Asri Blok C7","28/5/2026 13.20","Tunai",12000,"Nasi Goreng Solaria",15,"sendok plastik",""`;

/* ======================================================================
   Regresi dari file orderan sungguhan.

   orderan/Order-tanggal 5 - 6 Okt 2026.csv baris 74 menulis porsi separuh
   sebagai quantity 0.5 + note "setengah porsi". Aplikasi memakai varian
   "Separuh" dengan quantity 1, jadi kedua bentuk itu tidak pernah bertemu:
   varian tidak terdeteksi, qty tetap 0.5, dan harga ikut normal.

   Test ini memakai potongan file itu apa adanya, bukan karangan, supaya
   perbaikannya tidak hanya benar untuk contoh buatan.
   ====================================================================== */

const CSV_ASLI = `customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
ITS J 41,06/10/2026 05.55.00,Transfer,0,Mujair Bumbu Merah,1,,,dilarang digantung luar pagar
ITS J 41,06/10/2026 05.55.00,Transfer,0,Gule Daging,1,,,dilarang digantung luar pagar
ITS J 41,06/10/2026 05.55.00,Transfer,0,Lontong Kikil,1,,,dilarang digantung luar pagar
ITS J 41,06/10/2026 05.55.00,Transfer,0,Lodeh Rebung,0.5,,setengah porsi,dilarang digantung luar pagar
Sahabudin 26,06/10/2026 05.10.00,,5000,Lontong Kikil,1,45000,tanpa lontong,
Sahabudin 26,06/10/2026 05.10.00,,5000,Paru Goreng,1,,tanpa goreng,`;

/* Katalog 8 item menu 6 Okt 2026. Harga varian Separuh mengikuti
   halfVariantPrice, sama seperti yang ditulis halaman Menu. */
const katalog = (client_id: string, name: string, harga: number): KandidatProduk => ({
  client_id,
  name,
  sku: "",
  aliases: [],
  stok: null,
  variants: [
    { name: "Normal", price: harga, pricing_type: "fixed" },
    { name: "Separuh", price: halfVariantPrice(harga), pricing_type: "fixed" },
  ],
});

const KATALOG_6_OKT: KandidatProduk[] = [
  katalog("k1", "Lodeh Rebung", 25_000),
  katalog("k2", "Mujair Bumbu Merah", 25_000),
  katalog("k3", "Paru Goreng", 30_000),
  katalog("k4", "Telur Dadar", 20_000),
  katalog("k5", "Tempe Mendol", 10_000),
  katalog("k6", "Gule Daging", 35_000),
  katalog("k7", "Lontong Kikil", 30_000),
  katalog("k8", "Es Kacang Ijo", 10_000),
];

const dariCsv = (teks: string) => {
  const p = parsePesananCsv(teks).pesanan;
  return p.map((d) => normalisasiSeparuh(cocokkanDraft(d, KATALOG_6_OKT), KATALOG_6_OKT));
};

describe("CSV orderan asli 5-6 Okt 2026", () => {
  const [j41, sahabudin] = dariCsv(CSV_ASLI);
  const separuh = j41.items[3];

  it("parser membaca quantity 0.5 apa adanya", () => {
    expect(parsePesananCsv(CSV_ASLI).pesanan[0].items[3].qty).toBe(0.5);
  });

  it("Lodeh Rebung 0.5 jadi varian Separuh quantity 1", () => {
    expect(separuh.nama).toBe("Lodeh Rebung");
    expect(separuh.varian).toBe("Separuh");
    expect(separuh.qty).toBe(1);
  });

  it("hanya baris 0.5 yang berubah, tiga baris lain tetap 1", () => {
    expect(j41.items.slice(0, 3).map((i) => [i.varian, i.qty])).toEqual([
      ["Normal", 1],
      ["Normal", 1],
      ["Normal", 1],
    ]);
  });

  it("harga Rp 12.500, sama dengan hasil yang dulu", () => {
    expect(separuh.harga).toBe(12_500);
    expect(j41.total).toBe(25_000 + 35_000 + 30_000 + 12_500);
  });

  it("struk J 41 tetap siap diproses", () => {
    expect(statusDraft(j41)).toBe("Siap");
  });

  it("harga custom Rp 45.000 dari chat dipakai apa adanya dan tidak ditahan", () => {
    expect(sahabudin.items[0].harga).toBe(45_000);
    expect(sahabudin.items[0].perluCekHarga).toBe(false);
    expect(statusDraft(sahabudin)).toBe("Siap");
  });

  it("porsi separuh item Rp 10.000 tidak lagi kehilangan Rp 5.000", () => {
    /* Tempe Mendol normal 10.000. 0.5 x 10.000 = 5.000, tapi varian
       Separuh kena lantai minimum Rp 10.000. Selisih itu hilang diam-diam
       kalau qty 0.5 dibiarkan apa adanya. */
    const d = dariCsv("customer,chatDate,item,quantity\nBudi,06/10/2026 10.00,Tempe Mendol,0.5")[0];
    expect(d.items[0].qty).toBe(1);
    expect(d.items[0].harga).toBe(10_000);
  });

  it("item tanpa varian Separuh di menu ditahan, bukan_price 5.000 diam-diam", () => {
    const tanpaSeparuh = KATALOG_6_OKT.map((k) =>
      k.name === "Tempe Mendol" ? { ...k, variants: [{ name: "Normal", price: 10_000, pricing_type: "fixed" as const }] } : k,
    );
    const d = normalisasiSeparuh(
      cocokkanDraft(parsePesananCsv("customer,chatDate,item,quantity\nBudi,06/10/2026 10.00,Tempe Mendol,0.5").pesanan[0], tanpaSeparuh),
      tanpaSeparuh,
    );
    expect(d.items[0].perluVarianSeparuh).toBe(true);
    expect(blockingDraft(d)[0].pesan).toContain("varian Separuh tidak ada");
    expect(statusDraft(d)).toBe("Perlu review");
  });
});

describe("pisahCsv", () => {
  it("koma di dalam kutip tidak memotong kolom", () => {
    expect(pisahCsv('a,b\n"Nasi Goreng, besar",2')).toEqual([
      ["a", "b"],
      ["Nasi Goreng, besar", "2"],
    ]);
  });

  it("tanda kuit ganda di dalam kutip jadi satu", () => {
    expect(pisahCsv('x\n"Kapeng, ""K"" jadi"')[1]).toEqual(['Kapeng, "K" jadi']);
  });

  it(" CRLF, baris kosong, dan baris terakhir tanpa newline", () => {
    expect(pisahCsv("a,b\r\n1,2\r\n\r\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("BOM di awal file tidak ikut jadi header pertama", () => {
    expect(pisahCsv("﻿a,b\n1,2")[0]).toEqual(["a", "b"]);
  });
});

describe("parseUang", () => {
  it(" format Indonesia dan format polos", () => {
    expect(parseUang("Rp 10.000")).toBe(10_000);
    expect(parseUang("10000")).toBe(10_000);
    expect(parseUang("10.500,50")).toBe(10_500.5);
    expect(parseUang("")).toBe(0);
    expect(parseUang("-5")).toBe(0);
  });
});

describe("parseTanggal", () => {
  it("format Indonesia dengan jam", () => {
    expect(parseTanggal("28/5/2026 10.15")).toEqual({ tanggal: "2026-05-28", jam: "10:15" });
  });

  it("format ISO", () => {
    expect(parseTanggal("2026-05-28")).toEqual({ tanggal: "2026-05-28", jam: "" });
  });

  it("dua digit tahun jadi abad 21", () => {
    expect(parseTanggal("28/5/26").tanggal).toBe("2026-05-28");
  });

  it("tanggal rusak = kosong, bukan tanggal ngawur", () => {
    expect(parseTanggal("besok").tanggal).toBe("");
  });
});

describe("keCompletedAt", () => {
  it("jam lokal kasir disimpan sebagai UTC (+7)", () => {
    // 00.15 WIB 28 Mei = 17.15 UTC 27 Mei. Kalau tidak dikonversi, struk
    // muncul di tanggal sebelumnya.
    expect(keCompletedAt("2026-05-28", "00:15")).toBe("2026-05-27T17:15:00.000Z");
    expect(keCompletedAt("2026-05-28", "10:15")).toBe("2026-05-28T03:15:00.000Z");
  });

  it("tanpa jam = tengah malam lokal", () => {
    expect(keCompletedAt("2026-05-28", "")).toBe("2026-05-27T17:00:00.000Z");
  });

  it("tanggal tidak terbaca = null", () => {
    expect(keCompletedAt("", "10:00")).toBeNull();
  });
});

describe("parsePesananCsv", () => {
  it("mengelompokkan baris berurutan jadi satu pesanan", () => {
    const r = parsePesananCsv(SAMPLE, () => ({ client_id: "p", nama: "Nasi Goreng", price: 12_000 }));
    expect(r.pesanan).toHaveLength(3);
    expect(r.pesanan[0].items).toHaveLength(2);
    expect(r.pesanan[0].customer).toBe("Bu Ani - Jl Melati 12");
    expect(r.pesanan[1].customer).toBe("Pak Budi - Jl Kenanga 8");
  });

  it("baris tanpa harga memakai katalog", () => {
    const cariHarga: CariHarga = (_n, v) => (v === "Separuh" ? { client_id: "p1", nama: "X", price: 8_000 } : { client_id: "p1", nama: "X", price: 16_000 });
    const r = parsePesananCsv(SAMPLE, cariHarga);
    expect(r.pesanan[0].items[0].harga).toBe(16_000);
  });

  it("tanpa harga tetap muncul sebagai draft, ditandai belum diisi", () => {
    /* Versi lama juga begitu: draft-nya tetap muncul supaya yang belum
       terbaca kelihatan dan bisa diperbaiki — lewat kolom "Pilih Barang"
       dan kolom harga. Yang tetap dilarang nanti adalah MENYIMPAN struk
       yang masih bolong. */
    const r = parsePesananCsv(SAMPLE);
    expect(r.pesanan).toHaveLength(3);
    expect(r.pesanan.flatMap((p) => p.items).every((i) => i.hargaKosong)).toBe(true);
    expect(r.barisDilewati).toBe(0);
    expect(r.masalah.some((m) => m.pesan.includes("belum diisi"))).toBe(true);
    expect(r.masalah.some((m) => m.pesan.includes("belum dicocokkan"))).toBe(true);
  });

  it("total belum termasuk harga yang belum diisi", () => {
    const r = parsePesananCsv(SAMPLE);
    // Harga kosong berarti 0 — dan itulah sebabnya simpan ditahan, bukan
    // alasan untuk menyembunyikan barisnya.
    expect(r.pesanan.every((p) => p.total === p.ongkir)).toBe(true);
  });

  it("harga eksplisit di CSV dipakai apa adanya", () => {
    const csv = "customer,item,quantity,price\nBudi,Nasi Goreng,2,25000";
    const r = parsePesananCsv(csv);
    expect(r.pesanan[0].items[0].harga).toBe(25_000);
    expect(r.pesanan[0].items[0].hargaKosong).toBe(false);
    // Harga ada, tapi barangnya belum dicocokkan ke katalog — itu yang
    // membuat draft berstatus "Perlu review", sama seperti versi lama.
    expect(r.masalah.map((m) => m.pesan)).toEqual(['"Nasi Goreng" belum dicocokkan ke barang katalog']);
  });

  it("total = subtotal + ongkir", () => {
    const csv = "customer,ongkir,item,quantity,price\nBudi,15000,Nasi Goreng,2,10000";
    const r = parsePesananCsv(csv);
    expect(r.pesanan[0].subtotal).toBe(20_000);
    expect(r.pesanan[0].total).toBe(35_000);
  });

  it("nama menu kosong = dilewati dengan pesan", () => {
    const csv = "customer,item,quantity,price\nBudi,,2,10000\nBudi,Nasi,1,5000";
    const r = parsePesananCsv(csv);
    expect(r.barisDilewati).toBe(1);
    expect(r.masalah[0].pesan).toContain("kosong");
    expect(r.pesanan).toHaveLength(1);
  });

  it("jumlah bukan angka = dilewati, bukan jadi 0", () => {
    const csv = "customer,item,quantity,price\nBudi,Nasi,dua,10000\nBudi,Nasi Goreng,1,5000";
    const r = parsePesananCsv(csv);
    expect(r.barisDilewati).toBe(1);
    expect(r.masalah[0].pesan).toContain("bukan angka positif");
  });

  it("kolom alias Indonesia tetap dibaca", () => {
    const csv = "pelanggan;tanggal chat;barang;jumlah;harga;catatan\nBudi;28/5/2026 09.00;Nasi Goreng;3;7000;less";
    const r = parsePesananCsv(csv.replace(/;/g, ","));
    expect(r.pesanan[0].customer).toBe("Budi");
    expect(r.pesanan[0].items[0].qty).toBe(3);
    expect(r.pesanan[0].items[0].catatan).toBe("less");
  });

  it("perubahan pembayaran memecah pesanan", () => {
    const csv = "customer,payment,item,quantity,price\nBudi,Tunai,Nasi,1,5000\nBudi,Transfer,Nasi,1,5000";
    const r = parsePesananCsv(csv);
    expect(r.pesanan).toHaveLength(2);
  });

  it("sendNote tidak memecah pesanan", () => {
    // Catatan kirim sering hanya diisi di item pertama; kalau ikut jadi
    // pemisah, satu struk jadi beberapa.
    const csv = "customer,ongkir,item,quantity,price,sendNote\nBudi,10000,Nasi,1,5000,kirim pos\nBudi,10000,Es,1,3000,";
    const r = parsePesananCsv(csv);
    expect(r.pesanan).toHaveLength(1);
    expect(r.pesanan[0].items).toHaveLength(2);
    expect(r.pesanan[0].sendNote).toBe("kirim pos");
  });

  it("perubahan ongkir memecah pesanan", () => {
    const csv = "customer,ongkir,item,quantity,price\nBudi,0,Nasi,1,5000\nBudi,10000,Nasi,1,5000";
    const r = parsePesananCsv(csv);
    expect(r.pesanan).toHaveLength(2);
  });

  it("header tanpa kolom menu = pesan jelas, bukan hasil kosong diam-diam", () => {
    const r = parsePesananCsv("foo,bar\n1,2");
    expect(r.pesanan).toHaveLength(0);
    expect(r.masalah[0].pesan).toContain("Kolom menu tidak ditemukan");
  });

  it("file kosong tidak error", () => {
    expect(parsePesananCsv("")).toEqual({ pesanan: [], masalah: [], barisDibaca: 0, barisDilewati: 0 });
  });
});
