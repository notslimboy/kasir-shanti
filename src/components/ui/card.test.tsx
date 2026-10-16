// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Card, CardTitle, Pill } from "./card";

/* Dua sifat kecil di kartu yang gampang hilang saat dirapikan lagi.
 *
 * 1. Pill tidak boleh membungkus tulisannya. Label dua kata ("Belum
 *    Lunas") pecah jadi dua baris begitu barisnya sempit, tingginya
 *    melebihi tetangganya, dan deretan pill jadi bergerigi.
 * 2. Judul kartu bukan heading kedua. `Card` sudah membungkus `title`
 *    dengan `<h2>`; kalau `CardTitle` juga merender `<h2>`, satu judul
 *    terbaca dua kali oleh pembaca layar. */

afterEach(cleanup);

describe("Pill", () => {
  it("tidak membungkus tulisannya", () => {
    render(<Pill tone="warning">Belum Lunas</Pill>);
    expect(screen.getByText("Belum Lunas")).toHaveClass("whitespace-nowrap");
  });
});

describe("CardTitle", () => {
  it("tidak menambah heading kedua di dalam judul kartu", () => {
    render(
      <Card title={<CardTitle>Tren 30 hari</CardTitle>}>
        <p>isi</p>
      </Card>,
    );

    const headings = screen.getAllByRole("heading", { name: "Tren 30 hari" });
    expect(headings, "judul kartu terbaca sebagai dua heading").toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Tren 30 hari");
  });

  it("meneruskan kelas ukuran huruf dari pemanggilnya", () => {
    render(
      <Card title={<CardTitle className="text-sm sm:text-base">Tren 7 hari</CardTitle>}>
        <p>isi</p>
      </Card>,
    );
    /* Kelasnya menempel di pembungkus (span flex), bukan di span teksnya:
       ukuran huruf yang diwariskan sudah cukup, dan separator "?" tidak
       ikut membesar. Yang dijaga di sini cuma kelasnya benar-benar sampai —
       tanpa itu judul + tombol kembali tidak muat sebaris di 390px. */
    expect(screen.getByText("Tren 7 hari").parentElement).toHaveClass("text-sm");
  });
});
