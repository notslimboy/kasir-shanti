import { describe, expect, it } from "vitest";

import { saldoDepositUntuk } from "./deposit-customer";

const customers = [
  { id: "c1", name: "Bhaskara V/56", deposit: 50_000 },
  { id: "c2", name: "Mutiara Indah", deposit: 30_000 },
  { id: "c3", name: "Sari Makmur", deposit: 10_000 },
];

const alias = [
  { customer_id: 1, alias: "Bhas 7/17" },
  { customer_id: 2, alias: "Muti" },
  { customer_id: 1, alias: "Bhaskara" },
];

describe("saldoDepositUntuk", () => {
  it("nama persis case-sensitive berbeda tetap cocok", () => {
    expect(saldoDepositUntuk("bhaskara v/56", customers, alias)).toBe(50_000);
    expect(saldoDepositUntuk("Bhaskara V/56", customers, alias)).toBe(50_000);
  });

  it("beda spasi/tanda baca — normalisasi mengatasinya", () => {
    expect(saldoDepositUntuk("Bhaskara V / 56", customers, alias)).toBe(50_000);
  });

  it("alias persis dipakai", () => {
    expect(saldoDepositUntuk("Muti", customers, alias)).toBe(30_000);
  });

  it("alias dengan beda spasi/huruf", () => {
    expect(saldoDepositUntuk("  bhas 7/17  ", customers, alias)).toBe(50_000);
  });

  it("nama yang memuat nama customer — longest match dulu", () => {
    /* "bhaskara" adalah nama customer id=1 yang lebih pendek dari input.
       Diurutkan, "Mutiara Indah" (14 char) > "Bhaskara V/56" (13) > "Sari Makmur" (11)
       Tapi yang paling cocok adalah "Bhaskara" (sebagai substring dari "bhaskarav56").
       Input "Bhskara V /56" → normalized "bhskarav56". "bhaskara" tidak terkandung.
       Tapi "mutiaraindah" terkandung dalam "bhskaramutiara"? Tidak.
       Input: "bskarav56" → "bhskarav56". Nama "Sari" → "sari" tidak terkandung.
       Mari test kasus yang jelas: */
    expect(saldoDepositUntuk("pesan untuk Mutiara Indah", customers, alias)).toBe(30_000);
  });

  it("nama yang memuat — longgar dengan ejaan hampir sama", () => {
    /* Customer "Bhaskara" alias "Bhaskara" → normalized "bhaskara".
       Input "bhaskara v56" → normalized "bhaskarav56" yang memuat "bhaskara" */
    expect(saldoDepositUntuk("Bhaskara V56", customers, alias)).toBe(50_000);
  });

  it("alias yang memuat", () => {
    /* Alias "Bhas" untuk id=1 → normalized "bhas".
       Input "bhaskarav56" → tidak memuat "bhas"? 
       "bhaskarav56" mengandung "bhas"? b-h-a-s-k-a-r-a-v-5-6 → yes "bhas" is at the start.
       Oh wait, we need cari.includes(aKunci), so check if "bhas" is in "bhaskarav56" → yes! */
    const lokal = [
      { customer_id: 1, alias: "Bhas" },
    ];
    expect(saldoDepositUntuk("Bhaskara V/56", customers, lokal)).toBe(50_000);
  });

  it("tidak ketemu → 0", () => {
    expect(saldoDepositUntuk("Orang Asing", customers, alias)).toBe(0);
  });

  it("string kosong → 0", () => {
    expect(saldoDepositUntuk("", customers, alias)).toBe(0);
  });

  it("customer mirip tidak tertukar", () => {
    const dua = [
      { id: "c10", name: "Ayu Indah", deposit: 20_000 },
      { id: "c11", name: "Ayu Indah Permata", deposit: 40_000 },
    ];
    /* Input "Ayu Indah" → normalized "ayuindah".
       Nama terpanjang yang termuat: "ayuindah" → "Ayu Indah" (normalized "ayuindah") sama persis,
       "Ayu Indah Permata" → "ayuindahpermata" tidak termuat dalam "ayuindah".
       Jadi dapat 20_000, bukan 40_000. */
    expect(saldoDepositUntuk("Ayu Indah", dua, [])).toBe(20_000);
  });

  it("longest match: input panjang yang memuat beberapa customer", () => {
    const banyak = [
      { id: "c5", name: "Indah", deposit: 10_000 },
      { id: "c6", name: "Mutiara Indah", deposit: 30_000 },
    ];
    /* "Mutiara Indah" lebih panjang dari "Indah", jadi cocok "Mutiara Indah" dulu. */
    expect(saldoDepositUntuk("Pesan untuk Mutiara Indah", banyak, [])).toBe(30_000);
  });
});