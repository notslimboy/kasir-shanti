// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CatatanInput } from "./catatan-input";

/* Catatan per baris di keranjang kasir.
 *
 * Catatan sebelumnya dinormalkan pada setiap ketukan, jadi spasi di tengah
 * hilang: setelah spasi, teksnya dipangkas dan huruf berikutnya menempel —
 * "tanpa sambel" tersimpan sebagai "tanpasambel". Yang salah bukan
 * normalisasinya, melainkan WAKTUNYA. Karena itu yang diuji di sini adalah
 * mengetik huruf demi huruf, bukan `fill()` yang mengirim satu string utuh:
 * hanya cara pertama yang bisa menangkap bug ini. */

afterEach(cleanup);

function pasang(awal = "") {
  const onSelesai = vi.fn();
  render(
    <CatatanInput
      awal={awal}
      ariaLabel="Catatan Nasi Goreng"
      onSelesai={onSelesai}
    />,
  );
  return { onSelesai, input: screen.getByLabelText("Catatan Nasi Goreng") };
}

describe("CatatanInput", () => {
  it("menerima spasi saat kasir mengetik huruf demi huruf", async () => {
    const { onSelesai, input } = pasang();
    await userEvent.type(input, "tanpa sambel");
    expect(input).toHaveValue("tanpa sambel");

    await userEvent.keyboard("{Enter}");
    expect(onSelesai).toHaveBeenCalledWith("tanpa sambel");
  });

  it("menyimpan catatan lebih dari dua kata", async () => {
    const { onSelesai, input } = pasang();
    await userEvent.type(input, "saos banyak dan lombok dipisah");
    await userEvent.keyboard("{Enter}");
    expect(onSelesai).toHaveBeenCalledWith("saos banyak dan lombok dipisah");
  });

  it("membuang spasi tepi dan meratakan spasi ganda saat ditutup", async () => {
    const { onSelesai } = pasang("  saos  bnyak  ");
    await userEvent.keyboard("{Enter}");
    expect(onSelesai).toHaveBeenCalledWith("saos bnyak");
  });

  it("menutup dengan blur, bukan hanya Enter", async () => {
    /* Kasir biasanya langsung menekan item berikutnya tanpa menekan apa pun
       di keyboard — jadi blur adalah jalur simpan yang paling sering dipakai. */
    const { onSelesai, input } = pasang();
    await userEvent.type(input, "tanpa lombok");
    await userEvent.tab();
    expect(onSelesai).toHaveBeenCalledWith("tanpa lombok");
  });

  it("mengirim undefined kalau isinya dikosongkan", async () => {
    /* undefined, bukan "": kolom note di database dan struk memperlakukan ""
       sebagai "tidak ada catatan", jadi keduanya harus sama persis. */
    const { onSelesai, input } = pasang("tanpa sambel");
    await userEvent.clear(input);
    await userEvent.keyboard("{Enter}");
    expect(onSelesai).toHaveBeenCalledWith(undefined);
  });

  it("hanya mengirim sekali walau Enter diikuti blur", async () => {
    const { onSelesai, input } = pasang();
    await userEvent.type(input, "tanpa sambel{Enter}");
    input.blur();
    expect(onSelesai).toHaveBeenCalledTimes(1);
  });
});
