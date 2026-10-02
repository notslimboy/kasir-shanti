import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ==========================================================================
   Aturan: TIDAK BOLEH ada kontrol bawaan browser di app ini.

   <select> dan <input type="date"> membuka UI milik sistem operasi. UI itu
   tidak bisa diberi token tema, warnanya tidak konsisten antar platform,
   dan terpotong di layar kecil. Keduanya sudah diganti komponen sendiri
   (Select, DateRangePicker), jadi test ini harus gagal kalau suatu saat ada
   yang memakai kontrol native lagi.
   ========================================================================== */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === "dist") return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Buang komentar supaya nama tag yang sengaja ditulis di penjelasan
    tidak dianggap sebagai pemakaian sungguhan. */
function buangKomentar(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const LARANGAN: { label: string; pola: RegExp }[] = [
  { label: "<select> (dropdown bawaan browser)", pola: /<select[\s>]/ },
  { label: "<option>", pola: /<option[\s>]/ },
  { label: '<input type="date"> (kalender bawaan browser)', pola: /type\s*=\s*\{\s*["']date["']|type\s*=\s*["']date["']/ },
  { label: '<input type="month">', pola: /type\s*=\s*\{\s*["']month["']|type\s*=\s*["']month["']/ },
  { label: '<input type="time">', pola: /type\s*=\s*\{\s*["']time["']|type\s*=\s*["']time["']/ },
  { label: "<datalist>", pola: /<datalist[\s>]/ },
];

describe("tidak ada kontrol bawaan browser", () => {
  const files = walk(SRC).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  it("memindai file yang tidak kosong", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const { label, pola } of LARANGAN) {
    it(`dilarang: ${label}`, () => {
      const tersinggung = files
        .filter((f) => pola.test(buangKomentar(readFileSync(f, "utf-8"))))
        .map((f) => f.slice(SRC.length + 1));
      expect(tersinggung, `pakai ${label}, harus pakai komponen custom`).toEqual([]);
    });
  }

  it("komponen custom-nya benar-benar ada", () => {
    expect(files.some((f) => f.endsWith(join("ui", "select.tsx")))).toBe(true);
    expect(files.some((f) => f.endsWith(join("ui", "date-range.tsx")))).toBe(true);
  });
});
