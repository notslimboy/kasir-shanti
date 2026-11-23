import { describe, expect, it } from "vitest";

import { cocokMenu, ringkasMenu } from "./cari-menu";
import type { Sale } from "./sale";

// ─── cocokMenu — MUST match (true) ───────────────────────────────────────────
describe("cocokMenu — MUST match", () => {
  it.each([
    ["tepi tahu", "Tepo Tahu"],
    ["tpo tahu", "Tepo Tahu"],
    ["tepo tau", "Tepo Tahu"],
    ["rawon", "Rawon"],
    ["rawonn", "Rawon"],
    ["rwan", "Rawon"],
    ["ayam panggang", "Ayam Panggang"],
    ["ayam panggng", "Ayam Panggang"],
    ["ayam", "Ayam Panggang"],
    ["dawet", "Es Dawet"],
    ["es dawet", "Es Dawet"],
    ["dewet", "Es Dawet"],
    ["sate", "Sate Rempah"],
    ["sate rempah", "Sate Rempah"],
    ["tempe mendol", "Tempe Mendol"],
    ["mendol", "Tempe Mendol"],
    ["soto", "Soto Madura"],
    ["lumpur", "Lumpur Surga"],
    ["lumpur surga", "Lumpur Surga"],
    ["telor gulung", "Telur Gulung"],
    ["telur", "Telur Gulung"],
    ["nasi", "Nasi Putih"],
    ["ikan", "Ikan Kembung Pepes"],
    ["kembung", "Ikan Kembung Pepes"],
    ["urap", "Urap-Urap"],
    ["kotokan", "Kotokan Tahu Tempe"],
    ["lodeh", "Lodeh Cecek"],
    ["sayur lodeh", "Sayur Lodeh"],
  ])("cocokMenu(%j, %j) → true", (cari, namaItem) => {
    expect(cocokMenu(cari, namaItem)).toBe(true);
  });
});

// ─── cocokMenu — MUST NOT match (false) ──────────────────────────────────────
describe("cocokMenu — MUST NOT match", () => {
  it.each([
    ["rawon", "Ayam Panggang"],
    ["dawet", "Rawon"],
    ["sate", "Rawon"],
    ["bebek", "Rawon"],
    ["nasi", "Rawon"],
    ["", "Rawon"],
    ["   ", "Rawon"],
    ["a", "Rawon"],
  ])("cocokMenu(%j, %j) → false", (cari, namaItem) => {
    expect(cocokMenu(cari, namaItem)).toBe(false);
  });
});

// ─── Cross-contamination test ────────────────────────────────────────────────
describe("cocokMenu — cross-contamination", () => {
  const namaUnik = [
    "Rawon",
    "Ayam Panggang",
    "Urap-Urap",
    "Kotokan Tahu Tempe",
    "Sayur Lodeh",
    "Sate Rempah",
    "Tepo Tahu",
    "Telur Gulung",
    "Es Dawet",
    "Tahu Fantasi",
    "Lumpur Surga",
    "Nasi Putih",
    "Botok Simbukan",
    "Ikan Kembung Pepes",
    "Sayur Bening",
    "Lodeh Cecek",
    "Pepes Tongkol",
    "Ayam Kecap",
    "Nila Bakar",
    "Bebek Hitam",
    "Soto Madura",
    "Bakwan",
    "Tempe Mendol",
    "Perkedel",
  ];

  // Build all unordered pairs (i < j)
  const pairs: [string, string, number, number][] = [];
  for (let i = 0; i < namaUnik.length; i++) {
    for (let j = i + 1; j < namaUnik.length; j++) {
      pairs.push([namaUnik[i], namaUnik[j], i, j]);
    }
  }

  it("no pair of different names matches each other (0 false positives)", () => {
    let matchCount = 0;
    const failed: string[] = [];
    for (const [a, b] of pairs) {
      if (cocokMenu(a, b) || cocokMenu(b, a)) {
        matchCount++;
        failed.push(`${a} <-> ${b}`);
      }
    }
    if (failed.length > 0) {
      throw new Error(
        `${matchCount} cross-match(es) found:\n  ${failed.join("\n  ")}`,
      );
    }
    expect(matchCount).toBe(0);
  });

  // Specific regressions against "Kotokan Tahu Tempe" ↔ "Tepo Tahu"
  it('cocokMenu("tepo tahu", "Kotokan Tahu Tempe") === false', () => {
    expect(cocokMenu("tepo tahu", "Kotokan Tahu Tempe")).toBe(false);
  });
  it('cocokMenu("tempe", "Kotokan Tahu Tempe") === true', () => {
    expect(cocokMenu("tempe", "Kotokan Tahu Tempe")).toBe(true);
  });
  it('cocokMenu("tahu", "Tepo Tahu") === true', () => {
    expect(cocokMenu("tahu", "Tepo Tahu")).toBe(true);
  });
  it('cocokMenu("kotokan", "Tepo Tahu") === false', () => {
    expect(cocokMenu("kotokan", "Tepo Tahu")).toBe(false);
  });
});

// ─── Extra edge cases ────────────────────────────────────────────────────────
describe("cocokMenu — edge cases", () => {
  it("empty query against empty-ish name returns false", () => {
    expect(cocokMenu("", "")).toBe(false);
    expect(cocokMenu("   ", "")).toBe(false);
  });

  it("single char query against any name returns false", () => {
    expect(cocokMenu("n", "Nasi Putih")).toBe(false);
    expect(cocokMenu("s", "Sayur Lodeh")).toBe(false);
  });

  it("two-char substring matches if contained (es -> Es Dawet)", () => {
    // "es" after normalize = "es", "es dawet" includes "es" — fast path
    expect(cocokMenu("es", "Es Dawet")).toBe(true);
  });

  it("two-char that is NOT substring of name returns false", () => {
    expect(cocokMenu("da", "Es Dawet")).toBe(true); // "da" substring of "dawet"
    expect(cocokMenu("xx", "Rawon")).toBe(false);
  });
});

// ─── ringkasMenu ──────────────────────────────────────────────────────────────

function buatStruk(
  id: number,
  lines: { name: string; qty: number }[],
): Sale {
  return {
    id,
    receiptNo: `R${id}`,
    customer: "A",
    completedOn: "2026-01-01",
    completedIso: "2026-01-01T00:00:00.000Z",
    completedAt: "1 Jan 2026, 00:00",
    completedAtShort: "1 Jan 00:00",
    total: 10000,
    payment: "Tunai",
    itemCount: lines.length,
    status: "lunas",
    lines: lines.map((l) => ({
      name: l.name,
      variant: "Normal",
      qty: l.qty,
      price: 5000,
    })),
  };
}

const strukRawon = buatStruk(1, [{ name: "Rawon", qty: 2 }]);
const strukTepo = buatStruk(2, [{ name: "Tepo Tahu", qty: 1 }]);
const strukCampur = buatStruk(3, [
  { name: "Rawon", qty: 1 },
  { name: "Sayur Lodeh", qty: 3 },
]);
const strukTepo2 = buatStruk(4, [{ name: "Tepo Tahu", qty: 4 }]);

const semuaStruk = [strukRawon, strukTepo, strukCampur, strukTepo2];

describe("ringkasMenu", () => {
  it("empty query returns empty result", () => {
    const r = ringkasMenu(semuaStruk, "");
    expect(r.tampil).toEqual([]);
    expect(r.jumlahStruk).toBe(0);
    expect(r.totalPorsi).toBe(0);
    expect(r.rincian).toEqual([]);
  });

  it("whitespace query returns empty result", () => {
    const r = ringkasMenu(semuaStruk, "   ");
    expect(r.tampil).toEqual([]);
    expect(r.jumlahStruk).toBe(0);
  });

  it("filters struk by matching item name", () => {
    const r = ringkasMenu(semuaStruk, "Rawon");
    expect(r.jumlahStruk).toBe(2);
    expect(r.tampil.map((s) => s.id)).toEqual([1, 3]);
  });

  it("totalPorsi only counts matching lines", () => {
    const r = ringkasMenu(semuaStruk, "Rawon");
    // struk 1: qty 2, struk 3: qty 1 = 3. Sayur Lodeh (qty 3) excluded.
    expect(r.totalPorsi).toBe(3);
  });

  it("rincian sorted by porsi desc, then nama asc", () => {
    const r = ringkasMenu(semuaStruk, "Tepo Tahu");
    expect(r.rincian).toHaveLength(1);
    expect(r.rincian[0]).toEqual({ nama: "Tepo Tahu", porsi: 5, struk: 2 });
  });

  it("rincian merges same item name across struk", () => {
    const r = ringkasMenu(semuaStruk, "Rawon");
    expect(r.rincian).toHaveLength(1);
    expect(r.rincian[0].porsi).toBe(3);
    expect(r.rincian[0].struk).toBe(2);
  });

  it("struk without lines does not crash", () => {
    const s = [{ ...strukRawon, lines: undefined as unknown as Sale["lines"] }];
    const r = ringkasMenu(s, "Rawon");
    expect(r.jumlahStruk).toBe(0);
  });

  it("struk with empty lines does not crash", () => {
    const s = [{ ...strukRawon, lines: [] }];
    const r = ringkasMenu(s, "Rawon");
    expect(r.jumlahStruk).toBe(0);
  });

  it("does not mutate input array", () => {
    const copy = [...semuaStruk];
    ringkasMenu(semuaStruk, "Rawon");
    expect(semuaStruk.map((s) => s.id)).toEqual(copy.map((s) => s.id));
  });

  it("does not mutate struk objects inside input array", () => {
    const satu = buatStruk(99, [{ name: "Rawon", qty: 2 }]);
    const asli = { ...satu, lines: [...satu.lines] };
    ringkasMenu([satu], "Rawon");
    expect(satu.lines).toHaveLength(asli.lines.length);
    expect(satu.lines[0].name).toBe("Rawon");
  });

  it("fuzzy match works inside ringkasMenu", () => {
    const r = ringkasMenu(semuaStruk, "rwan"); // Levenshtein 1 → Rawon
    expect(r.jumlahStruk).toBe(2);
    expect(r.tampil.map((s) => s.id)).toEqual([1, 3]);
  });

  it("rincian with multiple items sorted by porsi desc then nama asc", () => {
    // Use "sate" as query — matches Sate Rempah (3) and also matches nothing else
    const r = ringkasMenu(
      [
        buatStruk(10, [
          { name: "Bakwan", qty: 5 },
          { name: "Rawon", qty: 2 },
          { name: "Sate Rempah", qty: 3 },
        ]),
      ],
      "sate",
    );
    // Only Sate Rempah matches: porsi 3
    expect(r.rincian.map((rn) => rn.nama)).toEqual(["Sate Rempah"]);
    expect(r.totalPorsi).toBe(3);
  });
});