import { describe, expect, it } from "vitest";

import { denganBatas } from "./cache-db";

/* Cache adalah kenyamanan, bukan syarat. Kalau IndexedDB tidak tersedia,
   penuh, atau menggantung, aplikasi HARUS tetap jalan dengan data dari
   server — jadi setiap operasi cache wajib punya batas waktu dan jalur
   cadangan yang mengembalikan "tidak ada". */

describe("denganBatas", () => {
  it("mengembalikan nilai kalau promise selesai", async () => {
    await expect(denganBatas(Promise.resolve("ok"), "fallback")).resolves.toBe("ok");
  });

  it("memakai nilai cadangan kalau promise ditolak", async () => {
    await expect(denganBatas(Promise.reject(new Error("indexedDB tidak bisa dibuka")), "fallback")).resolves.toBe(
      "fallback",
    );
  });

  it("tidak menggantung kalau promise tidak pernah selesai", async () => {
    /* Index 3 > 1.5 dtk, jadi ini akan kena batas waktu. Kalau batasnya
       hilang, test ini hangs — persis gejala yang akan dirasakan kasir:
       layar tidak pernah terisi. */
    const mulai = Date.now();
    const hasil = await denganBatas(new Promise<string>(() => {}), "fallback");
    expect(hasil).toBe("fallback");
    expect(Date.now() - mulai).toBeLessThan(4000);
  });

  it("nilai yang sudah datang lambat tetap tidak menimpa nilai setelahnya", async () => {
    const lambat = new Promise<string>((r) => setTimeout(() => r("telat"), 50));
    await expect(denganBatas(lambat, "fallback")).resolves.toBe("telat");
  });
});
