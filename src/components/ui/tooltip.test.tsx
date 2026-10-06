// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TeksPotong, Tooltip } from "./tooltip";

/* ---------------------------------------------------------------
   jsdom tidak punya layout: scrollWidth dan clientWidth selalu 0, jadi
   `scrollWidth > clientWidth` tidak pernah benar dan TeksPotong akan
   selalu memutuskan "tidak terpotong". Lebar dipalsukan di sini.

   Override-nya sengaja dipasang hanya pada elemen yang benar-benar
   dipotong — kalau dipasang untuk semua elemen, GetBoundingClientRect
   ikut terpengaruh dan posisi tooltip jadi tidak bisa diuji. */
function paksaLebar(lebarIsi: number, lebarTampil: number) {
  const asli = {
    scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  };
  const pasang = (nama: "scrollWidth" | "clientWidth", nilai: number) =>
    Object.defineProperty(HTMLElement.prototype, nama, {
      configurable: true,
      get(this: HTMLElement) {
        return String(this.className ?? "").includes("truncate") ? nilai : 0;
      },
    });
  pasang("scrollWidth", lebarIsi);
  pasang("clientWidth", lebarTampil);
  return () => {
    if (asli.scrollWidth) Object.defineProperty(HTMLElement.prototype, "scrollWidth", asli.scrollWidth);
    if (asli.clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", asli.clientWidth);
  };
}

afterEach(() => {
  cleanup();
});

describe("Tooltip", () => {
  it("tidak muncul sebelum kursor masuk ke pemicu", () => {
    render(
      <Tooltip teks="Isi lengkap">
        {(p) => <span {...p}>Isi</span>}
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("muncul dengan isi penuh saat pemicu disorot", () => {
    render(
      <Tooltip teks="Isi lengkap">
        {(p) => <span {...p}>Isi</span>}
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Isi"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Isi lengkap");
  });

  it("hilang lagi saat kursor keluar", () => {
    render(
      <Tooltip teks="Isi lengkap">
        {(p) => <span {...p}>Isi</span>}
      </Tooltip>,
    );
    const pemicu = screen.getByText("Isi");
    fireEvent.mouseEnter(pemicu);
    fireEvent.mouseLeave(pemicu);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("Escape menutup tooltip", () => {
    /* Tanpa ini, tooltip yang menutupi beberapa baris tidak bisa
       dibuang dari keyboard: mouseleave tidak pernah terjadi kalau
       pengguna memakai keyboard. */
    render(
      <Tooltip teks="Isi lengkap">
        {(p) => <span {...p}>Isi</span>}
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Isi"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("menghubungkan pemicu ke tooltip lewat aria-describedby", () => {
    render(
      <Tooltip teks="Penjelasan">
        {(p) => <span {...p}>Teks</span>}
      </Tooltip>,
    );
    const pemicu = screen.getByText("Teks");
    fireEvent.mouseEnter(pemicu);
    const id = screen.getByRole("tooltip").id;
    expect(pemicu).toHaveAttribute("aria-describedby", id);
  });

  it("tidak memakai atribut title bawaan browser", () => {
    /* `title` muncul terlambat, posisinya tidak bisa diatur, dan
       praktis tidak pernah muncul di Android. Kalau Attributes ini
       kembali, tooltip di layar kasir hilang tanpa terdeteksi. */
    render(
      <Tooltip teks="Penjelasan">
        {(p) => <span {...p}>Teks</span>}
      </Tooltip>,
    );
    expect(screen.getByText("Teks")).not.toHaveAttribute("title");
  });

  it("tidak merender apa pun untuk teks kosong", () => {
    render(
      <Tooltip teks="   ">
        {(p) => <span {...p}>Teks</span>}
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Teks"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dirender ke body, bukan di dalam wadah yang memotong", () => {
    /* Wadah tabel memakai overflow-x-auto. Kalau tooltip ikut
       dirender di dalamnya, ia terpotong tepat di tepi tabel — bagian
       yang justru paling ingin dilihat kasir. */
    render(
      <div style={{ overflow: "hidden" }} data-wadah>
        <Tooltip teks="Penjelasan panjang">
          {(p) => <span {...p}>Teks</span>}
        </Tooltip>
      </div>,
    );
    fireEvent.mouseEnter(screen.getByText("Teks"));
    const tip = screen.getByRole("tooltip");
    expect(tip.parentElement).toBe(document.body);
    expect(document.querySelector("[data-wadah]")).not.toContainElement(tip);
  });
});

describe("TeksPotong", () => {
  it("tidak memberi tooltip kalau teksnya muat", () => {
    const lepas = paksaLebar(40, 100);
    try {
      render(<TeksPotong teks="Pendek" />);
      fireEvent.mouseEnter(screen.getByText("Pendek"));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      lepas();
    }
  });

  it("memberi tooltip berisi teks utuh kalau terpotong", () => {
    /* Yang dipotong di layar adalah bagian yang tidak terbaca, jadi
       yang dikembalikan harus teks penuh, bukan potongan yang sama. */
    const lepas = paksaLebar(400, 100);
    try {
      render(<TeksPotong teks="Alamat lengkap yang sangat panjang sekali" />);
      fireEvent.mouseEnter(screen.getByText("Alamat lengkap yang sangat panjang sekali"));
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Alamat lengkap yang sangat panjang sekali",
      );
    } finally {
      lepas();
    }
  });

  it("toleran selisih satu piksel", () => {
    /* Lebar browser bisa pecah pecahan. Tanpa toleransi, teks yang pas
       persis di batas kolom mendapat tooltip yang isinya sama persis
       dengan yang sudah terbaca. */
    const lepas = paksaLebar(101, 100);
    try {
      render(<TeksPotong teks="Pas di batas" />);
      fireEvent.mouseEnter(screen.getByText("Pas di batas"));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      lepas();
    }
  });

  it("tidak memasang atribut title pada elemen yang dipotong", () => {
    const lepas = paksaLebar(400, 100);
    try {
      render(<TeksPotong teks="Alamat panjang sekali ini" />);
      expect(screen.getByText("Alamat panjang sekali ini")).not.toHaveAttribute("title");
    } finally {
      lepas();
    }
  });
});