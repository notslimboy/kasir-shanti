import { describe, expect, it } from "vitest";

import { rapikanCatatan, ringkasCatatan } from "./catatan-item";

const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));

describe("rapikanCatatan", () => {
  it("memangkas spasi di tepi", () => {
    expect(rapikanCatatan("  tanpa sambel  ")).toBe("tanpa sambel");
  });

  it("meratakan spasi berlebih menjadi satu", () => {
    /* Kasir mengetik cepat di HP, jadi spasi ganda itu hal biasa.
       Kalau ikut tersimpan, struk tercetak dengan spasi ganjil. */
    expect(rapikanCatatan("tanpa   sambel\tdan  lontong")).toBe(
      "tanpa sambel dan lontong",
    );
  });

  it("mengembalikan undefined untuk input kosong atau spasi saja", () => {
    /* undefined, bukan "": kolom note di database dan cetakan struk
       sama-sama memperlakukan "" sebagai tidak ada, jadi keduanya harus
       menyimpan nilai yang sama persis. */
    expect(rapikanCatatan("")).toBeUndefined();
    expect(rapikanCatatan("   ")).toBeUndefined();
    expect(rapikanCatatan("\n\t")).toBeUndefined();
  });

  it("mempertahankan catatan yang sah", () => {
    expect(rapikanCatatan("Tanpa Sambel")).toBe("Tanpa Sambel");
  });
});

describe("ringkasCatatan", () => {
  it("menampilkan nama dan jumlah seperti sebelumnya", () => {
    expect(
      ringkasCatatan(
        [
          { name: "Beef Slice Lada Hitam", qty: 1 },
          { name: "Es Teh", qty: 3 },
        ],
        fmtQty,
      ),
    ).toBe("Beef Slice Lada Hitam ×1, Es Teh ×3");
  });

  it("meletakkan catatan di dalam kurung", () => {
    expect(
      ringkasCatatan([{ name: "Nasi Goreng", qty: 1, note: "tanpa sambel" }], fmtQty),
    ).toBe("Nasi Goreng (tanpa sambel) ×1");
  });

  it("membedakan dua baris dengan menu sama tapi catatan berbeda", () => {
    /* Ini yang membuat daftar hold berguna: tanpa ini, kasir melihat dua
       baris "Nasi Goreng ×1" yang sama persis dan tidak tahu mana yang
       tanpa sambel. */
    const ringkas = ringkasCatatan(
      [
        { name: "Nasi Goreng", qty: 1 },
        { name: "Nasi Goreng", qty: 1, note: "tanpa sambel" },
      ],
      fmtQty,
    );
    expect(ringkas).toBe("Nasi Goreng ×1, Nasi Goreng (tanpa sambel) ×1");
  });

  it("mengabaikan catatan kosong saat meringkas", () => {
    expect(
      ringkasCatatan([{ name: "Es Teh", qty: 1, note: "   " }], fmtQty),
    ).toBe("Es Teh ×1");
  });

  it("memakai formatter jumlah milik pemanggil untuk pecahan", () => {
    expect(ringkasCatatan([{ name: "Kentang", qty: 0.5 }], fmtQty)).toBe(
      "Kentang ×0.5",
    );
  });

  it("menghasilkan string kosong untuk keranjang kosong", () => {
    expect(ringkasCatatan([], fmtQty)).toBe("");
  });
});