import { beforeEach, describe, expect, it, vi } from "vitest";
import { isProdukStale, padaProdukStale, resetProdukStale, tandaiProdukStale, } from "./data-source-signal";
/* ==========================================================================
   Test sinyal basi katalog — mekanisme komunikasi antara sync Google Sheet
   dan DataProvider untuk memicu ulang penarikan produk.
   ========================================================================== */
describe("tandaiProdukStale", () => {
    beforeEach(() => resetProdukStale());
    it("menandai katalog sebagai basi", () => {
        expect(isProdukStale()).toBe(false);
        tandaiProdukStale();
        expect(isProdukStale()).toBe(true);
    });
    it("memanggil pendengar yang terdaftar", () => {
        const fn = vi.fn();
        const cleanup = padaProdukStale(fn);
        tandaiProdukStale();
        expect(fn).toHaveBeenCalledTimes(1);
        cleanup();
    });
    it("pembatalan menghapus pendengar", () => {
        const fn = vi.fn();
        const cleanup = padaProdukStale(fn);
        cleanup();
        tandaiProdukStale();
        expect(fn).not.toHaveBeenCalled();
    });
    it("mendukung banyak pendengar", () => {
        const fn1 = vi.fn();
        const fn2 = vi.fn();
        const c1 = padaProdukStale(fn1);
        const c2 = padaProdukStale(fn2);
        tandaiProdukStale();
        expect(fn1).toHaveBeenCalledTimes(1);
        expect(fn2).toHaveBeenCalledTimes(1);
        c1();
        c2();
    });
    it("resetProdukStale menghapus tanda basi", () => {
        tandaiProdukStale();
        expect(isProdukStale()).toBe(true);
        resetProdukStale();
        expect(isProdukStale()).toBe(false);
    });
    it("reset membuat tanda siap untuk disetel lagi", () => {
        tandaiProdukStale();
        resetProdukStale();
        expect(isProdukStale()).toBe(false);
        tandaiProdukStale();
        expect(isProdukStale()).toBe(true);
    });
});
