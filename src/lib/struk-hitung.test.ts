import { describe, expect, it } from "vitest";
import { hitungUlang, statusSetelahTotal, subtotalDariBaris } from "@/lib/struk-hitung";
/* ==========================================================================
   Hitung ulang angka struk setelah item diedit.

   Test paling penting di berkas ini: ongkir harus BERTAHAN saat item
   berubah. Ongkos kirim tidak ada kolomnya di database - nilainya sisa
   dari `total - subtotal + diskon - pajak`. Kalau total dihitung dari
   jumlah baris item, ongkir lenyap dan kasir mengirim gratis.
   */
const BARIS = [
    { price: 20_000, qty: 2 }, // 40.000
    { price: 18_000, qty: 1 }, // 18.000
];
describe("subtotal dari baris", () => {
    it("mengalikan harga dengan jumlah", () => {
        expect(subtotalDariBaris(BARIS)).toBe(58_000);
    });
    it("baris qty 0 tidak dihitung", () => {
        expect(subtotalDariBaris([...BARIS, { price: 50_000, qty: 0 }])).toBe(58_000);
    });
    it("baris qty negatif tidak mengurangi total", () => {
        // Qty negatif berarti baris dihapus, bukan diskon. Kalau ikut
        // dihitung, subtotal jadi lebih kecil dari isi struk.
        expect(subtotalDariBaris([...BARIS, { price: 50_000, qty: -2 }])).toBe(58_000);
    });
    it("harga atau qty null diabaikan, bukan jadi NaN", () => {
        expect(subtotalDariBaris([
            { price: 20_000, qty: 1 },
            { price: Number.NaN, qty: 2 },
            { price: 10_000, qty: Number.NaN },
        ])).toBe(20_000);
    });
    it("struk tanpa item bernilai nol, bukan error", () => {
        expect(subtotalDariBaris([])).toBe(0);
    });
});
describe("ongkir bertahan saat item diedit", () => {
    /* Struk nyata: total 80.000, subtotal 58.000, tanpa diskon/pajak.
       Artinya ongkir = 80.000 - 58.000 = 22.000. */
    const STRUK = { diskon: 0, ongkir: 22_000, pajak: 0 };
    it("total baru = subtotal baru + ongkir yang sama", () => {
        const { total } = hitungUlang(BARIS, STRUK);
        expect(total).toBe(80_000);
    });
    it("menambah satu item menaikkan total TANPA menyentuh ongkir", () => {
        const tambah = [...BARIS, { price: 30_000, qty: 1 }];
        const { subtotal, total } = hitungUlang(tambah, STRUK);
        expect(subtotal).toBe(88_000);
        // 88.000 + 22.000 ongkir. Kalau ongkir ikut hilang, totalnya
        // 88.000 dan ongkir Rp 22.000 hilang tanpa jejak.
        expect(total).toBe(110_000);
    });
    it("mengurangi item menurunkan total, ongkir tetap utuh", () => {
        const kurang = [{ price: 20_000, qty: 1 }];
        const { total } = hitungUlang(kurang, STRUK);
        expect(total).toBe(42_000); // 20.000 + 22.000
    });
    it("menghapus semua item menyisakan ongkir saja, bukan nol", () => {
        // Ini kasus terburuk kalau ongkir ikut terhapus: struk jadi Rp 0
        // dan lookup piutang menganggapnya sudah lunas.
        const { subtotal, total } = hitungUlang([], STRUK);
        expect(subtotal).toBe(0);
        expect(total).toBe(22_000);
    });
    it("diskon ikut terpakai, bukan diabaikan", () => {
        const denganDiskon = hitungUlang(BARIS, { diskon: 8_000, ongkir: 22_000, pajak: 0 });
        // 58.000 - 8.000 + 0 + 22.000
        expect(denganDiskon.total).toBe(72_000);
    });
    it("pajak ikut terpakai", () => {
        const denganPajak = hitungUlang(BARIS, { diskon: 0, ongkir: 22_000, pajak: 1_160 });
        expect(denganPajak.total).toBe(81_160);
    });
    it("struk tanpa ongkir/diskon/pajak menghasilkan total yang sama dengan subtotal", () => {
        expect(hitungUlang(BARIS, {}).total).toBe(58_000);
    });
});
describe("status lunas setelah total berubah", () => {
    it("total turun dan uang sudah cukup -> lunas", () => {
        expect(statusSetelahTotal(50_000, 80_000)).toBe("lunas");
    });
    it("total naik melebihi uang -> belum", () => {
        expect(statusSetelahTotal(100_000, 80_000)).toBe("belum");
    });
    it("tepat sama -> lunas", () => {
        expect(statusSetelahTotal(80_000, 80_000)).toBe("lunas");
    });
    it("total nol tidak dianggap lunas meski uang penuh", () => {
        // Struktur yang dihapus total tidak boleh hilang dari kartu piutang
        // dengan status lunas.
        expect(statusSetelahTotal(0, 80_000)).toBe("belum");
    });
});
