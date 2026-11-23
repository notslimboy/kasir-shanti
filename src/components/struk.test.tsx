// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { sekaliJalan } from "@/lib/struk";

/**
 * Regresi dobel-cetak.
 *
 * `cetak()` di komponen Struk punya dua pemicu: iframe `srcdoc` yang bisa
 * sudah `readyState === "complete"` tepat setelah di-append, dan event
 * `load` yang tetap menyusul sesudahnya. Keduanya memanggil aksi yang sama,
 * jadi aksinya harus dibungkus `sekaliJalan`.
 *
 * Test di bawah menguji helper produksi itu sendiri, bukan salinan logika
 * yang ditulis ulang di dalam test — salinan seperti itu bisa lulus
 * walaupun kode aslinya bocor.
 */
describe("sekaliJalan — gerbang dobel cetak", () => {
  it("menjalankan aksi tepat satu kali walau dipanggil berkali-kali", () => {
    const aksi = vi.fn();
    const jalankan = sekaliJalan(aksi);

    jalankan();
    jalankan();
    jalankan();

    expect(aksi).toHaveBeenCalledTimes(1);
  });

  it("kedua pemicu (readyState selesai + event load) hanya mencetak sekali", async () => {
    const f = document.createElement("iframe");
    document.body.appendChild(f);

    if (!f.contentWindow) {
      document.body.removeChild(f);
      return;
    }

    const printSpy = vi.fn();
    f.contentWindow.print = printSpy;

    /* Bentuk yang dipakai cetak(): satu aksi, dua pemicu. */
    const jalankan = sekaliJalan(() => f.contentWindow?.print());

    // Pemicu 1: dokumen sudah selesai saat di-append.
    if (f.contentDocument?.readyState === "complete") jalankan();
    // Pemicu 2: event load menyusul.
    f.addEventListener("load", jalankan, { once: true });
    f.dispatchEvent(new Event("load"));

    expect(printSpy).toHaveBeenCalledTimes(1);
    document.body.removeChild(f);
  });
});
