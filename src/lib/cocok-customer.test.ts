import { describe, expect, it } from "vitest";
import { filterSaranCustomer, type SaranCustomer } from "@/lib/cocok-customer";

const c = (name: string, alias: string[] = [], ongkir = 0): SaranCustomer => ({
  name,
  alias,
  ongkir,
});

describe("filterSaranCustomer", () => {
  it("mencari berdasarkan nama asli", () => {
    const hasil = filterSaranCustomer([c("Bhaskara sari 38"), c("Anak 7/37")], "bhas");
    expect(hasil.map((x) => x.name)).toEqual(["Bhaskara sari 38"]);
  });

  it("ALIAS harus bisa menemukan nama aslinya — ini inti dari dropdown", () => {
    const hasil = filterSaranCustomer([c("Bhaskara sari 38", ["Bhas Sari 38"])], "bhas sari");
    expect(hasil.map((x) => x.name)).toEqual(["Bhaskara sari 38"]);
  });

  it("mengembalikan nama ASLI meski yang diketik adalah alias", () => {
    /* Kalau yang dikembalikan string yang diketik, struk akan menyimpan
       "Bhas Sari 38" dan customer itu jadi orang baru — ongkir, riwayat,
       dan piutang semuanya terpecah. */
    const hasil = filterSaranCustomer([c("Bhaskara sari 38", ["Bhas Sari 38"])], "Bhas Sari 38");
    expect(hasil[0].name).toBe("Bhaskara sari 38");
  });

  it("tidak case sensitive", () => {
    const hasil = filterSaranCustomer([c("ITS N 2", ["N - 2"])], "its n");
    expect(hasil).toHaveLength(1);
    const lain = filterSaranCustomer([c("ITS N 2", ["N - 2"])], "ITS N");
    expect(lain).toHaveLength(1);
  });

  it("mengabaikan spasi di awal dan akhir", () => {
    const hasil = filterSaranCustomer([c("Anak 7/37")], "  anak  ");
    expect(hasil).toHaveLength(1);
  });

  it("kueri kosong mengembalikan semuanya", () => {
    const semua = [c("A"), c("B")];
    expect(filterSaranCustomer(semua, "")).toHaveLength(2);
  });

  it("menandai alias yang cocok, supaya alasannya terlihat", () => {
    /* Kueri sengaja BUKAN substring dari nama asli — kalau iya, nama
       sendiri yang cocok dan jejak memang tidak perlu ditampilkan. */
    const hasil = filterSaranCustomer([c("Bhaskara sari 38", ["Bu Sari 38", "B39"])], "bu sari");
    expect(hasil[0].jejak).toBe("Bu Sari 38");
  });

  it("jejak kosong kalau yang cocok adalah nama aslinya", () => {
    const hasil = filterSaranCustomer([c("Bhaskara sari 38", ["Bhas Sari 38"])], "sari 38");
    expect(hasil[0].jejak).toBeUndefined();
  });

  it("mengurutkan berdasarkan nama", () => {
    const hasil = filterSaranCustomer([c("Zainuddin"), c("Anak 7/37")], "");
    expect(hasil.map((x) => x.name)).toEqual(["Anak 7/37", "Zainuddin"]);
  });

  it("memotong daftar di batas atas", () => {
    const banyak = Array.from({ length: 40 }, (_, i) => c(`Customer ${i}`));
    expect(filterSaranCustomer(banyak, "", 12)).toHaveLength(12);
  });
});