import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/* Backup diuji lewat dua sisi yang tidak bisa diuji langsung lewat UI:
   bentuk file yang keluar, dan bagaimana file rusak diperlakukan.

   Yang diuji di sini murni fungsi murni; unduh/unduh-restore browser
   (Blob, FileReader) tidak diuji — jsdom tidak mengimplementasikan
   keduanya dengan benar, jadi tes di sana hanya menguji mock. */

const cacheSemua = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const cacheTulisBanyak = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/cache-db", () => ({ cacheSemua, cacheTulisBanyak }));

import { namaFileBackup, pulihkanBackup, unduhBackup } from "./backup";

describe("backup perangkat", () => {
  beforeEach(() => {
    cacheSemua.mockReset();
    cacheTulisBanyak.mockReset();
    cacheSemua.mockResolvedValue([]);
    cacheTulisBanyak.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("namaFileBackup", () => {
    it("memuat tanggal dan jam supaya beberapa backup tidak tertukar", () => {
      // Nama tanpa waktu hanya jadi "Backup 1", "Backup 2" — dan setelah
      // tiga, tidak ada cara tahu yang mana yang benar.
      expect(namaFileBackup()).toMatch(/^kasir-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    });
  });

  describe("pulihkanBackup", () => {
    const sah = (isi: unknown) => JSON.stringify(isi);

    it("menolak file yang bukan JSON", async () => {
      const hasil = await pulihkanBackup("bukan json {{{");
      expect(hasil.ok).toBe(false);
      if (!hasil.ok) expect(hasil.pesan).toMatch(/JSON/);
    });

    it("menolak backup dari format lain, bukan dipaksakan", async () => {
      // Restore setengah jadi lebih buruk daripada ditolak: katalog ada
      // tapi struk-nya tidak, dan kasir tidak punya cara mengetahuinya.
      const hasil = await pulihkanBackup(sah({ format: 99, cache: [] }));
      expect(hasil.ok).toBe(false);
      if (!hasil.ok) expect(hasil.pesan).toMatch(/format/i);
    });

    it("menolak backup yang cache-nya bukan array", async () => {
      const hasil = await pulihkanBackup(sah({ format: 1, cache: "bukan array" }));
      expect(hasil.ok).toBe(false);
    });

    it("tidak menulis apa pun kalau backup ditolak", async () => {
      await pulihkanBackup("bukan json");
      expect(cacheTulisBanyak).not.toHaveBeenCalled();
    });

    it("menulis seluruh entri cache yang bentuknya benar", async () => {
      const hasil = await pulihkanBackup(
        sah({
          format: 1,
          dibuatPada: "2026-10-02T00:00:00.000Z",
          cache: [
            { key: "produk", ts: 111, data: { products: [] } },
            { key: "inti", ts: 222, data: { sales: [] } },
          ],
          local: {},
        }),
      );
      expect(hasil.ok).toBe(true);
      expect(cacheTulisBanyak).toHaveBeenCalledWith([
        { key: "produk", ts: 111, data: { products: [] } },
        { key: "inti", ts: 222, data: { sales: [] } },
      ]);
    });

    it("menyimpan ts apa adanya supaya umur cache tidak dipalsukan", async () => {
      // Restore tanpa ts menghasilkan cache yang terlihat berumur 0 detik,
      // sehingga data basi sempat dipakai seolah-olah baru.
      await pulihkanBackup(
        sah({ format: 1, dibuatPada: "x", cache: [{ key: "produk", ts: 999, data: {} }], local: {} }),
      );
      expect(cacheTulisBanyak).toHaveBeenCalledWith([
        { key: "produk", ts: 999, data: {} },
      ]);
    });

    it("melewatkan entri rusak tanpa membatalkan yang lain", async () => {
      // Satu kunci aneh tidak boleh menghapus seluruh data perangkat.
      const hasil = await pulihkanBackup(
        sah({
          format: 1,
          dibuatPada: "x",
          cache: [
            { key: "produk", ts: 1, data: {} },
            { key: 42, data: {} },
            { key: "inti", ts: 2 },
            null,
          ],
          local: {},
        }),
      );
      expect(hasil.ok).toBe(true);
      if (hasil.ok) expect(hasil.jumlahCache).toBe(2);
    });

    it("backup kosong tetap berhasil, bukan error", async () => {
      // Cadangan tanpa cache masih berguna (setelan printer), jadi
      // kegagalan di sini tidak boleh membuat pengguna batal backup.
      const hasil = await pulihkanBackup(sah({ format: 1, dibuatPada: "x", cache: [], local: {} }));
      expect(hasil.ok).toBe(true);
      // Nol entri = tidak ada yang perlu ditulis; cacheTulisBanyak dengan
      // array kosongnya sendiri sudah jadi no-op.
    });
  });

  /* bacaFile diuji lewat test lingkungan (e2e), bukan di sini: ia
   bergantung pada FileReader yang tidak ada di environment test ini, jadi
   tesnya cuma menguji mock — bukan bentuk API-nya. Yang dijamin di sini
   adalah apa yang SEBENARNYA bisa rusak: parsing, validasi format, dan
   apa yang ditulis ke cache. */

  it("unduhBackup melaporkan kegagalan sebagai pesan, bukan melempar", async () => {
    // URL.createObjectURL tidak ada di jsdom, jadi ini persis jalur yang
    // perlu dijamin: hasil.ok === false plus pesan, bukan exception yang
    // lolos ke caller dan menggagalkan seluruh halaman Pengaturan.
    cacheSemua.mockResolvedValue([]);
    const hasil = await unduhBackup();
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/gagal/i);
  });
});