import { describe, expect, it } from "vitest";
import { buildGoogleSheetCsvUrl, parseSheetCsv, rowsToCanonicalProducts } from "./sync-google-sheet";
/* ==========================================================================
   Test untuk sync-google-sheet — port fungsi URL & parser dari script.js.
   ========================================================================== */
describe("buildGoogleSheetCsvUrl", () => {
    const DEFAULT = "https://docs.google.com/spreadsheets/d/183BZtWGEj0JRE7qjTk1jXBnVFbz_oMti7tR2dkisJsc/edit?gid=0#gid=0";
    it("mengembalikan CSV URL dari sheet URL biasa", () => {
        const url = buildGoogleSheetCsvUrl(DEFAULT);
        expect(url).toContain("gviz/tq");
        expect(url).toContain("out%3Acsv"); // URL-encoded
        expect(url).toContain("183BZtWGEj0JRE7qjTk1jXBnVFbz_oMti7tR2dkisJsc");
        expect(url).toContain("gid=0");
    });
    it("menambahkan sheet name sebagai parameter", () => {
        const url = buildGoogleSheetCsvUrl(DEFAULT, "Menu");
        expect(url).toContain("sheet=Menu");
    });
    it("menggunakan gid dari parameter search jika tidak ada sheet name", () => {
        const url = buildGoogleSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc123/edit?gid=12345");
        expect(url).toContain("gid=12345");
    });
    it("menggunakan gid dari hash URL", () => {
        const url = buildGoogleSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=999");
        expect(url).toContain("gid=999");
    });
    it("sheet name lebih diutamakan daripada gid", () => {
        const url = buildGoogleSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc123/edit?gid=0#gid=0", "Produk");
        expect(url).toContain("sheet=Produk");
        expect(url).not.toContain("gid=");
    });
    it("/pubhtml diubah ke /pub?output=csv", () => {
        const url = buildGoogleSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc123/pubhtml");
        expect(url).toBe("https://docs.google.com/spreadsheets/d/abc123/pub?output=csv");
    });
    it("URL yang sudah berformat CSV dikembalikan apa adanya", () => {
        const csvUrl = "https://docs.google.com/spreadsheets/d/abc123/pub?output=csv";
        expect(buildGoogleSheetCsvUrl(csvUrl)).toBe(csvUrl);
    });
    it("tqx=out:csv dianggap sudah CSV", () => {
        const csvUrl = "https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv";
        expect(buildGoogleSheetCsvUrl(csvUrl)).toBe(csvUrl);
    });
    it("URL non-Google Sheet dikembalikan apa adanya", () => {
        expect(buildGoogleSheetCsvUrl("https://example.com/data.csv")).toBe("https://example.com/data.csv");
    });
    it("error kalau URL kosong", () => {
        expect(() => buildGoogleSheetCsvUrl("")).toThrow("Tempel link Google Sheet dulu.");
    });
    it("URL non-spreadsheet dikembalikan apa adanya", () => {
        // docs.google.com tapi bukan spreadsheet — fallback return as-is
        expect(buildGoogleSheetCsvUrl("https://docs.google.com/forms/d/abc")).toBe("https://docs.google.com/forms/d/abc");
    });
});
describe("parseSheetCsv", () => {
    it("memparse CSV dengan koma", () => {
        const csv = "nama,harga,stok\nOseng Tahu Tempe,10000,20\nSoto Madura,15000,\n";
        const rows = parseSheetCsv(csv);
        expect(rows).toHaveLength(2);
        expect(rows[0].nama).toBe("Oseng Tahu Tempe");
        expect(rows[0].harga).toBe("10000");
        expect(rows[0].stok).toBe("20");
        expect(rows[1].nama).toBe("Soto Madura");
        expect(rows[1].harga).toBe("15000");
        expect(rows[1].stok).toBe(""); // cell kosong
    });
    it("memparse CSV dengan petik dua", () => {
        const csv = 'nama,harga\n"Oseng,Tahu",10000\n';
        const rows = parseSheetCsv(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].nama).toBe("Oseng,Tahu");
    });
    it("mendeteksi delimiter tab", () => {
        const csv = "nama\tharga\tstok\nOseng Tahu Tempe\t10000\t20\n";
        const rows = parseSheetCsv(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].harga).toBe("10000");
    });
    it("mendeteksi delimiter titik koma", () => {
        const csv = "nama;harga;stok\nOseng Tahu Tempe;10000;20\n";
        const rows = parseSheetCsv(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].harga).toBe("10000");
    });
    it("mengabaikan baris kosong", () => {
        const csv = "nama,harga\nOseng,10000\n\nSoto,15000\n";
        const rows = parseSheetCsv(csv);
        expect(rows).toHaveLength(2);
    });
    it("menormalisasi \\r\\n dan \\r", () => {
        const csv = "nama,harga\r\nOseng,10000\rSoto,15000\n";
        const rows = parseSheetCsv(csv);
        expect(rows).toHaveLength(2);
    });
    it("mengembalikan array kosong untuk input kosong", () => {
        expect(parseSheetCsv("")).toEqual([]);
        expect(parseSheetCsv("   ")).toEqual([]);
    });
    it("baris dengan header saja mengembalikan array kosong", () => {
        expect(parseSheetCsv("nama,harga")).toEqual([]);
    });
});
describe("rowsToCanonicalProducts", () => {
    it("menggabungkan baris yang identik (nama+harga sama)", () => {
        const rows = [
            { nama: "Oseng Tahu Tempe 1/2", harga: "10000" },
            { nama: "Oseng Tahu Tempe 1/2", harga: "10000" },
            { nama: "Oseng Tahu Tempe 1/2", harga: "10000" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products).toHaveLength(1);
        expect(r.duplicates).toBe(2);
        expect(r.skipped).toBe(0);
    });
    it("146 baris identik jadi 1 produk", () => {
        const banyak = Array.from({ length: 146 }, () => ({
            nama: "Oseng Tahu Tempe 1/2",
            harga: "10000",
            stok: "20",
        }));
        const r = rowsToCanonicalProducts(banyak);
        expect(r.products).toHaveLength(1);
        expect(r.duplicates).toBe(145);
    });
    it("nama sama harga beda tetap terpisah (Pepes Tongkol rule)", () => {
        const rows = [
            { nama: "Pepes Tongkol", harga: "5000" },
            { nama: "Pepes Tongkol", harga: "20000" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products).toHaveLength(2);
        expect(r.duplicates).toBe(0);
    });
    it("baris tanpa nama atau harga <= 0 dilewati", () => {
        const rows = [
            { nama: "", harga: "10000" }, // tanpa nama
            { nama: "Test", harga: "0" }, // harga 0
            { nama: "Valid", harga: "15000" }, // valid
            { nama: "Nol", harga: "-500" }, // harga negatif
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products).toHaveLength(1);
        expect(r.products[0].name).toBe("Valid");
        expect(r.skipped).toBe(3);
    });
    it("kategori diisi dari baris pertama yang punya kategori", () => {
        // Simulasi bug lama: kategori hanya terisi di sebagian baris
        const rows = [
            { nama: "Sambel Tumpang", harga: "15000", kategori: "" },
            { nama: "Sambel Tumpang", harga: "15000", kategori: "Pelengkap" },
            { nama: "Sambel Tumpang", harga: "15000", kategori: "" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products).toHaveLength(1);
        expect(r.products[0].category).toBe("Pelengkap");
    });
    it("kategori kosong jadi Tanpa Kategori", () => {
        const rows = [
            { nama: "Nasi Goreng", harga: "15000" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products[0].category).toBe("Tanpa Kategori");
    });
    it("SKU sebagai kunci identitas", () => {
        // Dua baris SKU sama = produk yang sama walau nama beda
        const rows = [
            { nama: "Oseng Tahu Tempe 1/2", harga: "10000", sku: "OST1" },
            { nama: "Oseng Tahu 1/2", harga: "10000", sku: "OST1" }, // SKU sama = produk sama
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products).toHaveLength(1);
        expect(r.duplicates).toBe(1);
    });
    it("stok unlimited terdeteksi dari teks", () => {
        const rows = [
            { nama: "Nasi Putih", harga: "5000", stok: "unlimited" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products[0].stockUnlimited).toBe(true);
    });
    it("stok unlimited terdeteksi dari ∞", () => {
        const rows = [
            { nama: "Nasi Putih", harga: "5000", stok: "∞" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products[0].stockUnlimited).toBe(true);
    });
    it("alias digabung dari baris duplikat", () => {
        const rows = [
            { nama: "Mendoan", harga: "3000", alias: "mendoan tahu" },
            { nama: "Mendoan", harga: "3000", alias: "tahu mendoan" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products[0].aliases).toContain("mendoan tahu");
        expect(r.products[0].aliases).toContain("tahu mendoan");
    });
    it("harga dengan format Indonesia (Rp 10.000)", () => {
        const rows = [
            { nama: "Bakso", harga: "Rp 10.000" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products[0].price).toBe(10000);
    });
    it("kolom alternatif: kode = SKU, jenis = kategori", () => {
        const rows = [
            { nama: "Bakso", harga: "10000", kode: "BKS1", jenis: "Makanan" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products).toHaveLength(1);
        expect(r.products[0].sku).toBe("bks1");
        expect(r.products[0].category).toBe("Makanan");
    });
    it("jumlah baris kosong", () => {
        const r = rowsToCanonicalProducts([]);
        expect(r.products).toHaveLength(0);
        expect(r.skipped).toBe(0);
        expect(r.duplicates).toBe(0);
    });
});
describe("rowsToCanonicalProducts — edge cases", () => {
    it("spasi berlebih pada nama dinormalisasi tapi tidak mengubah makna", () => {
        const rows = [
            { nama: "  Oseng  Tahu  ", harga: "10000" },
            { nama: "oseng tahu", harga: "10000" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products).toHaveLength(1);
        expect(r.duplicates).toBe(1);
        // Nama yang disimpan adalah dari baris pertama
        expect(r.products[0].name).toBe("Oseng  Tahu");
    });
    it("kategori dari baris pertama dipertahankan", () => {
        const rows = [
            { nama: "Tempe Mendoan", harga: "5000", kategori: "Lauk" },
            { nama: "Tempe Mendoan", harga: "5000", kategori: "Lainnya" },
        ];
        const r = rowsToCanonicalProducts(rows);
        expect(r.products[0].category).toBe("Lauk");
    });
    it("beberapa SKU berbeda tetap terpisah", () => {
        const rows = [
            { nama: "Nasi Goreng", harga: "15000", sku: "NG1" },
            { nama: "Nasi Goreng", harga: "15000", sku: "NG2" },
        ];
        const r = rowsToCanonicalProducts(rows);
        // SKU beda → produk beda (walau nama & harga sama)
        expect(r.products).toHaveLength(2);
        expect(r.duplicates).toBe(0);
    });
});
/* ==========================================================================
   Test pemicu sinkron — coalescing & debounce.
   ========================================================================== */
import { vi, beforeEach, afterEach } from "vitest";
import { triggerSyncFromSheet, __test } from "./sync-google-sheet";
describe("triggerSyncFromSheet — coalescing", () => {
    beforeEach(() => {
        vi.stubGlobal("navigator", { onLine: true });
        __test.resetState();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        __test.resetState();
    });
    it("menolak panggilan kedua saat masih dalam proses", () => {
        /* Panggilan pertama: atur triggerPending = true, lalu async jalan. */
        __test.lastSyncCompletedAt = 0; // pastikan debounce tidak memblokir
        triggerSyncFromSheet();
        expect(__test.triggerPending).toBe(true);
        /* Panggilan kedua: lihat triggerPending masih true → return. */
        triggerSyncFromSheet();
        expect(__test.triggerPending).toBe(true); // tidak berubah
    });
    it("menghormati jeda debounce 10 detik", () => {
        /* Setelah sinkron selesai, panggilan dalam 10 detik ditolak. */
        __test.lastSyncCompletedAt = Date.now();
        triggerSyncFromSheet();
        expect(__test.triggerPending).toBe(false); // diblokir debounce
    });
    it("mengizinkan sinkron setelah jeda debounce berlalu", () => {
        /* Lebih dari 10 detik sejak sinkron terakhir → boleh jalan. */
        __test.lastSyncCompletedAt = Date.now() - 11_000;
        triggerSyncFromSheet();
        expect(__test.triggerPending).toBe(true); // lolos debounce
    });
    it("diblokir saat offline", () => {
        vi.stubGlobal("navigator", { onLine: false });
        __test.lastSyncCompletedAt = 0;
        triggerSyncFromSheet();
        expect(__test.triggerPending).toBe(false);
    });
});
