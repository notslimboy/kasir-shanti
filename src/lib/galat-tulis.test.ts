import { describe, expect, it } from "vitest";

import { galatValidasi, jelaskanGalatTulis, ringkasTeknis } from "@/lib/galat-tulis";

/* Error dari server masuk ke layar kasir apa adanya: "23505 — duplicate key
   value violates unique constraint customers_name_key". Tidak ada yang bisa
   dilakukan dari kalimat itu, dan mengetiknya pun tidak akan memperbaiki
   apa pun.

   Test di sini mengunci dua hal: setiap error yang dikenal jadi kalimat
   yang menyebut tindakan berikutnya, dan tidak ada jargon Postgres yang
   bocor ke bagian yang dibaca kasir. */

describe("jelaskanGalatTulis", () => {
  it("23505: nama customer sudah dipakai", () => {
    const g = jelaskanGalatTulis(409, { code: "23505" }, "Memet 22");
    expect(g.judul).toBe("Nama itu sudah dipakai");
    /* Nama yang bentrok harus disebut, kalau tidak kasir tidak tahu
       yang mana yang perlu diganti. */
    expect(g.penjelasan).toContain("Memet 22");
    expect(g.langkah.length).toBeGreaterThan(10);
  });

  it("42501 dan 403: izin belum dijalankan", () => {
    for (const status of [403]) {
      const g = jelaskanGalatTulis(status, { code: "42501" }, "Memet 22");
      expect(g.judul).toContain("belum boleh");
      expect(g.penjelasan).toContain("izin");
    }
  });

  it("401: sesi login habis", () => {
    const g = jelaskanGalatTulis(401, null, "Memet 22");
    expect(g.judul).toContain("login");
    expect(g.langkah).toContain("masuk");
  });

  it("404: baris tidak ada", () => {
    const g = jelaskanGalatTulis(404, null, "Memet 22");
    expect(g.judul).toContain("tidak ditemukan");
  });

  it("5xx: server bermasalah, bukan input kasir", () => {
    const g = jelaskanGalatTulis(503, null, "Memet 22");
    expect(g.judul).toContain("bermasalah");
    /* Server yang sedang salah, jadi kalimatnya tidak boleh menyalahkan
       yang mengetik. "salah" dalam arti "salah ketik" — kata "bermasalah"
       sendiri boleh, karena ituldrinya ke server. */
    const kalimat = `${g.judul} ${g.penjelasan}`.toLowerCase();
    expect(kalimat).not.toContain("salah ketik");
    expect(kalimat).not.toContain("input");
    expect(kalimat).not.toContain("tidak valid");
  });

  it("status tak dikenal tetap dapat langkah", () => {
    const g = jelaskanGalatTulis(418, null, "Memet 22");
    expect(g.judul.length).toBeGreaterThan(0);
    expect(g.langkah.length).toBeGreaterThan(0);
  });

  /* Bagian yang dibaca kasir tidak boleh memuat jargon. Detail teknis ada
     di field `teknis`, yang sengaja dirender kecil di bawah. */
  it("tidak membocorkan jargon ke judul, penjelasan, dan langkah", () => {
    const jargon = /duplicate key|unique constraint|row-level security|policy|23505|42501|42703|PGRST|violates/i;
    for (const status of [409, 403, 401, 404, 400, 500, 418]) {
      const g = jelaskanGalatTulis(status, { code: "42501", message: "duplicate key value" }, "Memet 22");
      expect(g.judul).not.toMatch(jargon);
      expect(g.penjelasan).not.toMatch(jargon);
      expect(g.langkah).not.toMatch(jargon);
    }
  });

  it("menaruh kode dan pesan server di field teknis", () => {
    const g = jelaskanGalatTulis(409, { code: "23505", message: "duplicate key value" }, "Memet 22");
    expect(g.teknis).toContain("409");
    expect(g.teknis).toContain("23505");
  });

  it("memotong nama yang sangat panjang supaya pesan tidak jadi paragraf", () => {
    const panjang = "a".repeat(120);
    const g = jelaskanGalatTulis(409, { code: "23505" }, panjang);
    expect(g.penjelasan.length).toBeLessThan(140);
    expect(g.penjelasan).toContain("…");
  });

  it("body non-objek tidak membuat crash", () => {
    expect(() => jelaskanGalatTulis(500, "string", "X")).not.toThrow();
    expect(jelaskanGalatTulis(500, null, "X").judul.length).toBeGreaterThan(0);
  });
});

describe("ringkasTeknis", () => {
  it("menyusun code, message, dan hint", () => {
    expect(ringkasTeknis({ code: "42501", message: "no", hint: "cek" })).toBe("42501 · no · cek");
  });

  it("mengembalikan undefined saat tidak ada yang berguna", () => {
    expect(ringkasTeknis(null)).toBeUndefined();
    expect(ringkasTeknis({})).toBeUndefined();
    expect(ringkasTeknis("bukan objek")).toBeUndefined();
  });
});

describe("galatValidasi", () => {
  it("memberi langkah tanpa detail teknis", () => {
    const g = galatValidasi("Nama customer tidak boleh kosong.");
    expect(g.judul).toBeTruthy();
    expect(g.langkah.length).toBeGreaterThan(0);
    expect(g.teknis).toBeUndefined();
  });
});