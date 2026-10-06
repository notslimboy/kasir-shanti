import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* How many rows the Beranda cards ask for.
 *
 * "Pelanggan Favorit" renders whatever `pelangganFavoritDari` returns, and
 * that helper defaults to five. When Beranda passed no explicit count, the
 * card quietly showed five rows while the intent was six, and nothing noticed:
 * a card rendering fewer rows than expected looks exactly like a card with
 * fewer customers.
 *
 * Asserted on the source text because the alternative is mounting all of
 * Beranda with its charts and data wiring just to count `<li>` elements. */

/* `../../` — this file sits in src/pages/, so one level up is still src/. */
const root = fileURLToPath(new URL("../../", import.meta.url));
const beranda = readFileSync(root + "src/pages/beranda.tsx", "utf8");

describe("jumlah baris kartu Beranda", () => {
  it("Pelanggan Favorit meminta enam baris", () => {
    const baris = beranda.match(/pelangganFavoritDari\(\s*live\.customers\s*,\s*(\d+)\s*\)/);
    expect(baris, "pelangganFavoritDari tidak dipanggil dengan batas eksplisit").not.toBeNull();
    expect(Number(baris![1])).toBe(6);
  });

  it("memakai batas eksplisit, bukan default helper", () => {
    /* `pelangganFavoritDari(live.customers)` compiles fine and renders five.
       That is the exact shape that hid the mismatch. */
    expect(beranda).not.toMatch(/pelangganFavoritDari\(\s*live\.customers\s*\)/);
  });

  it("memetakan satu <li> per pelanggan, tanpa batas kedua di markup", () => {
    /* A second slice in the JSX would silently override the count above. */
    expect(beranda).not.toMatch(/favorit\.slice\(/);
  });
});