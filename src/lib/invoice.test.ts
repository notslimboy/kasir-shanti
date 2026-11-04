import { describe, expect, it } from "vitest";

import {
  invoiceBalance,
  invoiceLineTotal,
  invoiceSubtotal,
  invoiceTotal,
  normalizeInvoiceData,
  normalizeNumericInput,
  numericValue,
  type InvoiceItem,
} from "@/lib/invoice";

describe("invoice calculations", () => {
  it("normalizes empty quantity and leading zero values", () => {
    expect(normalizeNumericInput("00012.500" )).toBe("12500");
    expect(numericValue("")).toBe(0);
    expect(invoiceLineTotal({ id: "a", name: "Nasi", quantity: "", price: "5000" })).toBe(0);
    expect(invoiceLineTotal({ id: "b", name: "Nasi", quantity: "0002", price: "0005000" })).toBe(10000);
  });

  it("uses nota fees but keeps invoice total to item subtotal", () => {
    const items: InvoiceItem[] = [
      { id: "a", name: "Nasi", quantity: "2", price: "10000" },
      { id: "b", name: "Teh", quantity: "1", price: "5000" },
    ];
    expect(invoiceSubtotal(items)).toBe(25000);
    expect(invoiceSubtotal([])).toBe(0);
    const data = {
      documentNumber: "", date: "", customerName: "", deliveryFee: "3000", serviceFee: "1000", downPayment: "", items,
    };
    expect(invoiceTotal(data, "nota")).toBe(29000);
    expect(invoiceTotal(data, "invoice")).toBe(25000);
    const empty = {
      documentNumber: "", date: "", customerName: "", deliveryFee: "", serviceFee: "", downPayment: "", items: [],
    };
    expect(invoiceTotal(empty, "nota")).toBe(0);
    expect(invoiceTotal(empty, "invoice")).toBe(0);
  });

  it("marks DP equal to or above total invalid and keeps balance safe", () => {
    expect(invoiceBalance(10000, "10000")).toEqual({ downPayment: 0, invalidDownPayment: true, remainingBalance: 10000 });
    expect(invoiceBalance(10000, "12000")).toEqual({ downPayment: 0, invalidDownPayment: true, remainingBalance: 10000 });
    expect(invoiceBalance(10000, "2500")).toEqual({ downPayment: 2500, invalidDownPayment: false, remainingBalance: 7500 });
    expect(invoiceBalance(0, "500").remainingBalance).toBe(0);
  });
});

describe("stored invoice normalization", () => {
  it("keeps string fields, normalizes invalid item rows, and ensures one editable row", () => {
    expect(normalizeInvoiceData({
      documentNumber: 123,
      customerName: "Ayu",
      items: [{ id: "saved", quantity: 2, name: "Nasi", price: "9000" }, null],
    })).toEqual({
      documentNumber: "",
      date: "",
      customerName: "Ayu",
      deliveryFee: "",
      serviceFee: "",
      downPayment: "",
      items: [
        { id: "saved", quantity: "", name: "Nasi", price: "9000" },
        { id: "stored-item-2", quantity: "", name: "", price: "" },
      ],
    });
    expect(normalizeInvoiceData({ items: [] }).items).toEqual([
      { id: "stored-item-1", quantity: "", name: "", price: "" },
    ]);
    expect(normalizeInvoiceData(null).customerName).toBe("");
  });
});
