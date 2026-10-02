import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ==========================================================================
   Aturan layout KPI.

   Empat kartu angka (omset hari ini, bulan ini, minggu ini, piutang) harus
   2x2 sejak mobile. Kalau grid-nya `sm:grid-cols-2`, di bawah 640px hanya
   menyisakan satu kolom: 4 kartu jadi 648px tinggi dan menutupi seluruh
   isi halaman sebelum layar pertama benar-benar terlihat.

   Diuji dari sumber, bukan dari screenshot, supaya tidak ikut gagal hanya
   karena satu ukuran layar.
   ========================================================================== */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === "dist") return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

const PAGES_DENGAN_KPI = [
  "beranda.tsx",
  "penjualan.tsx",
  "piutang.tsx",
  "customer.tsx",
];

describe("grid KPI 2x2 sejak mobile", () => {
  const files = walk(SRC);

  it("halaman KPI memuat grid 2 kolom di breakpoint dasar", () => {
    const salah: string[] = [];
    for (const halaman of PAGES_DENGAN_KPI) {
      const f = files.find((x) => x.endsWith(join("pages", halaman)));
      if (!f) {
        salah.push(`${halaman}: file tidak ditemukan`);
        continue;
      }
      const src = readFileSync(f, "utf-8");
      const punyaEmpatKpi = (src.match(/<KpiCard/g) ?? []).length === 4 ||
        (src.match(/<StatTile/g) ?? []).length === 4;
      if (!punyaEmpatKpi) continue;
      // harus ada grid-cols-2 sebagai kolom PERTAMA, bukan sm:grid-cols-2
      if (!/className="grid grid-cols-2/.test(src)) {
        salah.push(`${halaman}: 4 kartu KPI tapi tidak pakai "grid grid-cols-2"`);
      }
    }
    expect(salah).toEqual([]);
  });

  it("tidak ada pola lama sm:grid-cols-2 xl:grid-cols-4", () => {
    // Pola ini yang bikin satu kolom di mobile. Kalau muncul lagi, KPI
    // akan menanjang ke bawah tanpa sengaja.
    const bersalah = files
      .filter((f) => /sm:grid-cols-2 xl:grid-cols-4/.test(readFileSync(f, "utf-8")))
      .map((f) => f.slice(SRC.length + 1));
    expect(bersalah).toEqual([]);
  });
});

describe("angka KPI muat di dua kolom mobile", () => {
  it("KpiCard dan StatTile punya ukuran font responsif", () => {
    const kpi = readFileSync(join(SRC, "components", "kpi-card.tsx"), "utf-8");
    const kit = readFileSync(join(SRC, "components", "ui", "kit.tsx"), "utf-8");
    // nilai nominal di mobile tidak boleh tetap 30px — meluber dari kartu
    expect(kpi).toMatch(/text-\[19px\][^"]*sm:text-\[26px\]/);
    expect(kit).toMatch(/text-\[17px\][^"]*sm:text-xl/);
  });
});

describe("chart mengikuti lebar card", () => {
  it("ChartBox punya mode fill", () => {
    const src = readFileSync(join(SRC, "components", "chart-box.tsx"), "utf-8");
    expect(src).toContain("fill");
    // mode fill memosisikan diri absolute inset-0, bukan height:100%.
    // `height:100%` hanya definit kalau induk punya tinggi definit, dan
    // card mobile/tablet hanya punya min-h — jadi tinggi chart memanjang
    // sendiri dan keluar dari kartu. Lihat komentar panjang di chart-box.tsx.
    expect(src).toMatch(/fill \? `absolute inset-0/);
    expect(src).not.toMatch(/height: fill \? "100%"/);
  });

  it("Card fillBody memberi konteks posisi dan meng-clip isi", () => {
    const src = readFileSync(join(SRC, "components", "ui", "card.tsx"), "utf-8");
    // relatif: ChartBox fillAbsolutely butuh ancestor ber-position, kalau
    // tidak akan search ke atas dan melompat keluar kartu.
    expect(src).toMatch(/fillBody && "relative/);
    // clip: isi yang lebih lebar dari kartu (chart, tabel, bar progress)
    // harus terpotong di dalam radius kartu, bukan menimpa kartu tetangga.
    expect(src).toMatch(/fillBody && "overflow-hidden"/);
  });

  it("daftar di dalam card fillBody tidak meluber ke samping", () => {
    // `overflow-y-auto` sendirian membiarkan konten yang lebih lebar lolos ke
    // samping tanpa terpotong — itu yang membuat bar progress Ongkir per
    // Kurir keluar dari kartu di mobile. Pasangan min-w-0 + overflow-x-hidden
    // yang menutupnya.
    for (const f of ["components/kurir-card.tsx", "components/kot-card.tsx"]) {
      const src = readFileSync(join(SRC, f), "utf-8");
      expect(src, f).toMatch(/min-h-0 min-w-0 flex-1/);
      expect(src, f).toMatch(/overflow-x-hidden overflow-y-auto/);
    }
  });

  it("donut pembayaran tidak dikunci lebar tetap", () => {
    // Donut 132px hardcoded meluber di kartu sempit: flex row
    // `items-center` mendorong isi melewati tepi kartu. Sekarang donat
    // mengukur ruang yang tersedia lalu menyusut sesuai ruang itu.
    const beranda = readFileSync(join(SRC, "pages", "beranda.tsx"), "utf-8");
    const penjualan = readFileSync(join(SRC, "pages", "penjualan.tsx"), "utf-8");
    for (const [nama, src] of [["beranda", beranda], ["penjualan", penjualan]] as const) {
      expect(src, nama).not.toMatch(/PieChart width=\{1[23]\d\}/);
      expect(src, nama).toContain("<ChartDonut");
    }
    // Diameter datang dari CSS breakpoint, bukan angka yang ditulis di JSX.
    // Kalau dibalik jadi "kotak mengukur diri sendiri lalu width-nya ditulis
    // dari hasil ukur", kotak jadi circular: d = 0 selamanya, donut tidak
    // pernah render.
    const donut = readFileSync(join(SRC, "components", "chart-donut.tsx"), "utf-8");
    expect(donut).toMatch(/h-\[104px\] w-\[104px\][^"]*sm:h-\[120px\][^"]*xl:h-\[132px\]/);
    expect(donut).not.toMatch(/style=\{\{\s*width:\s*d/);
  });

  it("rasio radius donut terhadap diameter, bukan terhadap radius luar", () => {
    // Bug yang membuat donut hilang TOTAL di semua breakpoint:
    // innerRadius dihitung dari rasio terhadap outerRadius (40/62 = 0.645)
    // lalu dikali diameter, jadi 67 — lebih besar dari outerRadius 50.
    // Recharts tidak menggambar arc saat inner > outer.
    // Yang benar: kedua radius proporsional ke diameter (40/132, 62/132).
    const src = readFileSync(join(SRC, "components", "chart-donut.tsx"), "utf-8");
    expect(src).toMatch(/RASIO_DALAM = 40 \/ 132/);
    expect(src).toMatch(/RASIO_LUAR = 62 \/ 132/);

    // Asersi geometri dari angka aslinya, bukan dari teks: untuk setiap
    // diameter yang dipakai di CSS, dalam harus lebih kecil dari luar.
    const dalam = (d: number) => Math.round(d * (40 / 132));
    const luar = (d: number) => Math.round(d * (62 / 132));
    for (const d of [104, 120, 132]) {
      expect(dalam(d), `d=${d}`).toBeLessThan(luar(d));
      expect(dalam(d), `d=${d}`).toBeGreaterThan(0);
      // cincin harus punya tebal yang masuk akal, bukan jadi garis tipis
      expect(luar(d) - dalam(d), `d=${d}`).toBeGreaterThan(d * 0.1);
      // label tengah harus muat di dalam diameter dalam
      expect(dalam(d), `d=${d}`).toBeGreaterThan(d * 0.25);
    }
  });

  it("card chart punya tinggi definite, bukan hanya min-h", () => {
    // min-h sendirian tidak menghentikan loop tinggi ChartBox mode fill.
    // Di halaman yang chart-nya mengisi card, tinggi minimal harus
    // diterjemahkan jadi tinggi pasti per breakpoint, atau isi card
    // sendiri yang menentukan seberapa tinggi dirinya.
    const penjualan = readFileSync(join(SRC, "pages", "penjualan.tsx"), "utf-8");
    expect(penjualan).toMatch(/className="min-h-\[300px\] xl:h-\[340px\]"/);
  });

  it("halaman beranda memakai Card fillBody untuk chart tren", () => {
    const src = readFileSync(join(SRC, "pages", "beranda.tsx"), "utf-8");
    expect(src).toMatch(/fillBody[\s\S]{0,200}min-h-\[300px\]/);
  });

  it("grid tiga kolom di Penjualan mulai di lg, bukan xl", () => {
    // Tablet (768-1280px) cukup lebar untuk dua kolom yang nyaman.
    // Memaksakan tiga kolom hanya di xl membuat tablet jatuh ke satu
    // kolom dengan tinggi tetap, dan tiga chart jadi kotak kosong.
    const src = readFileSync(join(SRC, "pages", "penjualan.tsx"), "utf-8");
    expect(src).toMatch(/lg:grid-cols-2 xl:grid-cols-\[/);
  });
});
