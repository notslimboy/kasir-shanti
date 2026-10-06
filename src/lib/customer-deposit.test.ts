import { describe, expect, it } from "vitest";

import {
  kunciNama,
  paidSetelahBatal,
  pilihCustomer,
  type CustomerDeposit,
} from "@/lib/customer-deposit";

/* Ini logika uang. Salah di sini menghasilkan deposit yang hilang atau
   pembayaran yang tercatat dua kali, jadi setiap aturan di bawah dikunci
   dengan test — bukan dengan harapan. */

const CUST: CustomerDeposit[] = [
  { id: 82, name: "44 Ny. Iin Oman - Jl. Memet Sastrowiryo No 22", deposit_balance: 0 },
  { id: 164, name: "Memet 22", deposit_balance: 250_000 },
  { id: 63, name: "Anak Bu Edi Baru - Sutorejo Tengah VI Gg 11", deposit_balance: 0 },
  { id: 1887, name: "ITS U 180", deposit_balance: 0 },
];

describe("kunciNama", () => {
  it("mengabaikan spasi, tanda baca, kapitalisasi, dan aksen", () => {
    expect(kunciNama("Mutiara C3 / 367")).toBe(kunciNama("Mutiara C3/367"));
    expect(kunciNama("its u 180")).toBe(kunciNama("ITS U 180"));
    expect(kunciNama("BPD B 34-35")).toBe(kunciNama("bpd b3435"));
  });

  /* Angka itu identitas. Kalau kunci ikut membuang atau memangkas angka,
     "ITS U 180" dan "ITS U 80" bisa bertemu. */
  it("tidak boleh menggabungkan nomor yang berbeda", () => {
    expect(kunciNama("ITS U 180")).not.toBe(kunciNama("ITS U 80"));
    expect(kunciNama("ITS U 180")).not.toBe(kunciNama("ITS U 1800"));
  });
});

describe("pilihCustomer", () => {
  const ALIAS = [
    { customer_id: 164, alias: "Memet 22." },
    { customer_id: 1887, alias: "U180" },
    { customer_id: 82, alias: "Bu Oman" },
  ];

  it("cocok pada nama persis lebih dulu", () => {
    expect(pilihCustomer("Memet 22", CUST, ALIAS)?.id).toBe(164);
  });

  /* Ini yang paling sering terjadi: kasir mengetik nama yang hanya beda
     spasi atau tanda baca dari yang tercatat. */
  it("cocok pada nama ternormalisasi", () => {
    expect(pilihCustomer("ITS  U  180", CUST, ALIAS)?.id).toBe(1887);
    expect(pilihCustomer("mutiara c3/367", CUST, ALIAS)).toBeNull();
  });

  /* Alias ada persis untuk kasus ini: orang yang sama ditulis berbeda.
     Versi lama hanya mencoba nama persis, lalu membuat customer baru —
     itu yang memecah deposit dan menambah duplikat. */
  it("cocok lewat tabel alias", () => {
    expect(pilihCustomer("U180", CUST, ALIAS)?.id).toBe(1887);
    expect(pilihCustomer("Bu Oman", CUST, ALIAS)?.id).toBe(82);
    expect(pilihCustomer("Memet 22.", CUST, ALIAS)?.id).toBe(164);
  });

  it("tidak mengarang customer ketika tidak ada yang cocok", () => {
    /* Dikembalikan null, bukan customer terdekat. Pemanggil yang memutuskan
       membuat baris baru atau menolak. */
    expect(pilihCustomer("Customer Yang Belum Ada", CUST, ALIAS)).toBeNull();
    expect(pilihCustomer("", CUST, ALIAS)).toBeNull();
  });

  /* Hasil harus stabil: kalau dua baris kebetulan cocok, pilihan tidak
     boleh berganti tiap reload. */
  it("memilih id terkecil kalau lebih dari satu cocok", () => {
    const kembar: CustomerDeposit[] = [
      { id: 300, name: "Kembar", deposit_balance: 0 },
      { id: 100, name: "Kembar", deposit_balance: 0 },
    ];
    expect(pilihCustomer("Kembar", kembar, [])?.id).toBe(100);
  });

  it("alias yang cuma mengulang nama sendiri tidak menyesatkan", () => {
    const aliasDuplikat = [{ customer_id: 164, alias: "memet 22" }];
    expect(pilihCustomer("MEMET 22", CUST, aliasDuplikat)?.id).toBe(164);
  });
});

describe("paidSetelahBatal", () => {
  const payments = [
    { id: 1, amount: 50_000 },
    { id: 2, amount: 30_000 },
    { id: 3, amount: 20_000 },
  ];
  const id = (p: { id: number }) => p.id;

  /* Pembatalan menghapus semua pembayaran struk itu, jadi sisa 0 — dan
     itu benar. Yang penting bukan angkanya, tapi bahwa angka itu dihitung
     dari riwayat, bukan ditulis `0` tanpa melihat apa pun. */
  it("nol ketika semua pembayaran dibatalkan", () => {
    expect(paidSetelahBatal(payments, new Set([1, 2, 3]), id)).toBe(0);
  });

  it("menjumlahkan pembayaran yang tidak ikut dihapus", () => {
    expect(paidSetelahBatal(payments, new Set([2]), id)).toBe(70_000);
    expect(paidSetelahBatal(payments, new Set([3]), id)).toBe(80_000);
  });

  it("mengabaikan baris dengan nominal rusak", () => {
    const rusak = [
      { id: 1, amount: 10_000 },
      { id: 2, amount: Number.NaN },
      { id: 3, amount: -5_000 },
    ];
    expect(paidSetelahBatal(rusak, new Set(), id)).toBe(10_000);
  });

  it("nol untuk riwayat kosong", () => {
    expect(paidSetelahBatal([], new Set(), id)).toBe(0);
  });
});