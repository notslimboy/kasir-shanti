import { describe, expect, it } from "vitest";
import { saranCustomer, type AliasCustomer } from "./cocok-customer";

/* Alias customer menentukan apakah dropdown ini berguna atau hanya
   dekorasi. Kalau alias tidak terikat ke customer yang benar, kasir
   menyimpan transaksi di customer yang salah — dan struk itu tetap
   terlihat "normal" sampai rekonsiliasi. */

function c(id: number, name: string, ongkir = 0) {
  return { id: `c${id}`, name, ongkir };
}

const alias = (...rows: [number, string][]): AliasCustomer[] =>
  rows.map(([customer_id, alias]) => ({ customer_id, alias }));

describe("saranCustomer", () => {
  it("mengikat alias ke customer yang benar lewat customer_id", () => {
    const s = saranCustomer(
      [c(1, "Bhaskara sari 38"), c(2, "Anak 7/37")],
      alias([1, "Bhas Sari 38"], [2, "N - 2"]),
    );
    expect(s.find((x) => x.name === "Bhaskara sari 38")?.alias).toEqual(["Bhas Sari 38"]);
  });

  it("tidak menempelkan alias ke customer yang namanya mirip", () => {
    /* Dua nama berdekatan. Kalau pencocokan nama dipakai sebagai ganti
       customer_id, alias "Bhas Sari 38" bisa menempel ke keduanya. */
    const s = saranCustomer(
      [c(1, "Bhaskara sari 38"), c(2, "Bhaskara sari 39")],
      alias([1, "Bhas Sari 38"]),
    );
    expect(s.find((x) => x.name === "Bhaskara sari 39")?.alias).toEqual([]);
  });

  it("membuang alias yang induknya sudah tidak ada", () => {
    /* Penghapusan customer bisa meninggalkan alias yatim. Menampilkannya
       berarti kasir bisa membuat customer yang tidak ada. */
    const s = saranCustomer([c(1, "Anak 7/37")], alias([99, "Yatim 1"]));
    expect(s).toHaveLength(1);
    expect(s[0].alias).toEqual([]);
  });

  it("mengelompokkan beberapa alias pada satu customer", () => {
    const s = saranCustomer([c(1, "Anak 7/37")], alias([1, "N - 2"], [1, "Anak 7/37"]));
    expect(s[0].alias).toEqual(["N - 2", "Anak 7/37"]);
  });

  it("customer tanpa alias tetap jadi saran", () => {
    const s = saranCustomer([c(1, "SAHABUDIN 26")], []);
    expect(s).toHaveLength(1);
    expect(s[0].alias).toEqual([]);
  });

  it("membuang nama kosong", () => {
    const s = saranCustomer([c(1, "  "), c(2, "Anak 7/37")], []);
    expect(s.map((x) => x.name)).toEqual(["Anak 7/37"]);
  });

  it("mengurutkan berdasarkan nama, bukan urutan database", () => {
    const s = saranCustomer([c(1, "Zainuddin"), c(2, "Anak 7/37"), c(3, "Mulyo BPD B-1")], []);
    expect(s.map((x) => x.name)).toEqual(["Anak 7/37", "Mulyo BPD B-1", "Zainuddin"]);
  });

  it("mempertahankan ongkir dari customer", () => {
    expect(saranCustomer([c(1, "Anak 7/37", 15_000)], [])[0].ongkir).toBe(15_000);
  });

  it("tidak memotong 327 customer — yang tampil dipotong saat filter", () => {
    /* Memotong di sini akan membuang customer yang namanya mengandung
       huruf yang diketik. Yang perlu dipotong 12 baris, dan itu tugas
       filter. */
    const banyak = Array.from({ length: 500 }, (_, i) => c(i + 1, `Customer ${i + 1}`));
    expect(saranCustomer(banyak, [])).toHaveLength(400);
  });
});