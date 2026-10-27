/* Client cache tests for itsfood-api. Vitest runs in node, so a Map-backed
   Storage is installed per test (nothing else in this suite touches the
   browser storage globals). */

const memAntara = new Map<string, string>();
const sesiAntara = new Map<string, string>();

function pasangStorage(): void {
  const buat = (map: Map<string, string>): Storage => ({
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => map.set(k, String(v)),
  });
  (globalThis as { localStorage?: Storage }).localStorage = buat(memAntara);
  (globalThis as { sessionStorage?: Storage }).sessionStorage = buat(sesiAntara);
}

import {
  bersihkanSesiLama,
  bacaCacheKlien,
  dgnCacheKlien,
  kosongkanCacheKlien,
  pangkasSimpanan,
  segarkanKlien,
} from "@/lib/itsfood-api";

import { beforeEach, describe, expect, it, vi } from "vitest";

const KUNCI = "uji-istimewa";
const HARI = 24 * 3600_000;

beforeEach(() => {
  pasangStorage();
  memAntara.clear();
  sesiAntara.clear();
  kosongkanCacheKlien([""]); /* reset KEDUA lapis antar test */
});

describe("dgnCacheKlien", () => {
  it("menulis ke localStorage (persist)", async () => {
    const data = { orders: [1, 2, 3] };
    const hasil = await dgnCacheKlien(KUNCI, async () => data);
    expect(hasil).toEqual(data);
    const menisk = localStorage.getItem(`itsfood:v3:${KUNCI}`);
    expect(menisk).toBeTruthy();
    expect(JSON.parse(menisk as string)).toEqual({ data, at: expect.any(Number) });
  });

  it("call kedua (bukan paksa) tidak mem-fetch ulang", async () => {
    const fetcher = vi.fn(async () => ({ nilai: "a" }));
    await dgnCacheKlien(KUNCI, fetcher);
    await dgnCacheKlien(KUNCI, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("paksa menimpa cache dan fetch ulang", async () => {
    let nilai = 1;
    const fetcher = vi.fn(async () => ({ nilai: nilai++ }));
    const pertama = await dgnCacheKlien(KUNCI, fetcher);
    const kedua = await dgnCacheKlien(KUNCI, fetcher, { paksa: true });
    expect(pertama).toEqual({ nilai: 1 });
    expect(kedua).toEqual({ nilai: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("gagal tarik (paksa) → data lama tetap di memori", async () => {
    await dgnCacheKlien(KUNCI, async () => ({ nilai: "lama" }));
    await expect(
      dgnCacheKlien(
        KUNCI,
        async () => {
          throw new Error("portal mati");
        },
        { paksa: true },
      ),
    ).rejects.toThrow("portal mati");
    expect(bacaCacheKlien(KUNCI)).toEqual({ nilai: "lama" });
  });
});

describe("bacaCacheKlien", () => {
  it("membaca entri APA PUN umurnya (tanpa TTL)", () => {
    localStorage.setItem(`itsfood:v3:${KUNCI}`, JSON.stringify({ data: { nilai: "kemarin" }, at: Date.now() - 3 * HARI }));
    expect(bacaCacheKlien(KUNCI)).toEqual({ nilai: "kemarin" });
  });

  it("entri rusak dibuang, bukan meledak", () => {
    localStorage.setItem(`itsfood:v3:${KUNCI}`, "{bukan json");
    expect(bacaCacheKlien(KUNCI)).toBeUndefined();
    expect(localStorage.getItem(`itsfood:v3:${KUNCI}`)).toBeNull();
  });

  it("entri bentuk salah (data undefined) dianggap tidak ada", () => {
    localStorage.setItem(`itsfood:v3:${KUNCI}`, JSON.stringify({ at: Date.now() }));
    expect(bacaCacheKlien(KUNCI)).toBeUndefined();
  });
});

describe("segarkanKlien (silent SWR)", () => {
  it("selalu fetch walau cache segar, lalu menimpa", async () => {
    let nilai = "lama";
    await dgnCacheKlien(KUNCI, async () => ({ nilai }));
    nilai = "baru";
    const hasil = await segarkanKlien(KUNCI, async () => ({ nilai }));
    expect(hasil).toEqual({ nilai: "baru" });
    expect(bacaCacheKlien(KUNCI)).toEqual({ nilai: "baru" });
  });

  it("gagal segarkan tidak menghapus data lama", async () => {
    await dgnCacheKlien(KUNCI, async () => ({ nilai: "lama" }));
    await expect(
      segarkanKlien(KUNCI, async () => {
        throw new Error("peak");
      }),
    ).rejects.toThrow();
    expect(bacaCacheKlien(KUNCI)).toEqual({ nilai: "lama" });
  });
});

describe("kosongkanCacheKlien", () => {
  it("menghapus kedua lapis hanya untuk prefiks yang diminta", async () => {
    await dgnCacheKlien("orders:2026-01-01:2026-01-31", async () => ({ x: 1 }));
    await dgnCacheKlien("payments", async () => ({ x: 2 }));
    kosongkanCacheKlien(["orders:"]);
    expect(bacaCacheKlien("orders:2026-01-01:2026-01-31")).toBeUndefined();
    expect(bacaCacheKlien("payments")).toEqual({ x: 2 });
    expect(localStorage.getItem("itsfood:v3:orders:2026-01-01:2026-01-31")).toBeNull();
    expect(localStorage.getItem("itsfood:v3:payments")).toBeTruthy();
  });
});

describe("pangkasSimpanan", () => {
  const tulis = (kunci: string, at: number) =>
    localStorage.setItem(`itsfood:v3:${kunci}`, JSON.stringify({ data: { x: 1 }, at }));

  it("detail >10 hari dibuang, yang segar tetap", () => {
    tulis("detail:100", Date.now() - 11 * HARI);
    tulis("detail:200", Date.now() - 1 * HARI);
    pangkasSimpanan();
    expect(localStorage.getItem("itsfood:v3:detail:100")).toBeNull();
    expect(localStorage.getItem("itsfood:v3:detail:200")).toBeTruthy();
  });

  it("orders: sisakan 8 bulan terbaru", () => {
    for (let i = 0; i < 12; i++) tulis(`orders:2025-${String(i).padStart(2, "0")}-01:2025-01-31`, Date.now() - i * HARI);
    pangkasSimpanan();
    const sisa: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("itsfood:v3:orders:")) sisa.push(k);
    }
    expect(sisa).toHaveLength(8);
  });
});

describe("bersihkanSesiLama", () => {
  it("menghapus hanya kunci itsfood:* di sessionStorage", () => {
    sessionStorage.setItem("itsfood:v2:kunci-lama", "x");
    sessionStorage.setItem("bukan-itsfood", "y");
    bersihkanSesiLama();
    expect(sessionStorage.getItem("itsfood:v2:kunci-lama")).toBeNull();
    expect(sessionStorage.getItem("bukan-itsfood")).toBe("y");
  });
});
