export type DocumentMode = "nota" | "invoice";

export type InvoiceItem = {
  id: string;
  quantity: string;
  name: string;
  price: string;
};

export type InvoiceData = {
  documentNumber: string;
  date: string;
  customerName: string;
  deliveryFee: string;
  serviceFee: string;
  downPayment: string;
  items: InvoiceItem[];
};

export const INVOICE_DATA_KEY = "kasir-shanti-invoice-v1";
export const INVOICE_MODE_KEY = "kasir-shanti-invoice-mode-v1";
export const INVOICE_COUNTER_KEY = "kasir-shanti-invoice-counter-v1";

export const createInvoiceItem = (id: string = crypto.randomUUID()): InvoiceItem => ({
  id,
  quantity: "",
  name: "",
  price: "",
});

export const initialInvoiceData = (): InvoiceData => ({
  documentNumber: "",
  date: "",
  customerName: "",
  deliveryFee: "",
  serviceFee: "",
  downPayment: "",
  items: [createInvoiceItem()],
});

export function normalizeNumericInput(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

export function numericValue(value: string): number {
  return Number(normalizeNumericInput(value)) || 0;
}

export function formatNumericInput(value: string): string {
  const normalized = normalizeNumericInput(value);
  return normalized ? new Intl.NumberFormat("id-ID").format(Number(normalized)) : "";
}

export function formatInvoiceCurrency(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatInvoiceDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatInvoiceNumber(counter: number): string {
  const safeCounter = Number.isFinite(counter) && counter > 0 ? Math.floor(counter) : 1;
  return `ShantiCatering-${String(safeCounter).padStart(6, "0")}`;
}

export function invoiceLineTotal(item: InvoiceItem): number {
  return numericValue(item.quantity) * numericValue(item.price);
}

export function invoiceSubtotal(items: InvoiceItem[]): number {
  return items.reduce((sum, item) => sum + invoiceLineTotal(item), 0);
}

export function invoiceTotal(data: InvoiceData, mode: DocumentMode): number {
  const itemTotal = invoiceSubtotal(data.items);
  return mode === "nota"
    ? itemTotal + numericValue(data.deliveryFee) + numericValue(data.serviceFee)
    : itemTotal;
}

export function invoiceBalance(total: number, downPayment: string) {
  const downPaymentValue = numericValue(downPayment);
  const invalidDownPayment = downPaymentValue > 0 && downPaymentValue >= total;
  const validDownPayment = invalidDownPayment ? 0 : downPaymentValue;
  return {
    downPayment: validDownPayment,
    invalidDownPayment,
    remainingBalance: Math.max(0, total - validDownPayment),
  };
}

const storedString = (value: unknown) => (typeof value === "string" ? value : "");

export function normalizeInvoiceData(value: unknown): InvoiceData {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const storedItems = Array.isArray(data.items) ? data.items : [];
  const items = storedItems.map((value, index): InvoiceItem => {
    const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
      id: storedString(item.id) || `stored-item-${index + 1}`,
      quantity: storedString(item.quantity),
      name: storedString(item.name),
      price: storedString(item.price),
    };
  });
  return {
    documentNumber: storedString(data.documentNumber),
    date: storedString(data.date),
    customerName: storedString(data.customerName),
    deliveryFee: storedString(data.deliveryFee),
    serviceFee: storedString(data.serviceFee),
    downPayment: storedString(data.downPayment),
    items: items.length ? items : [createInvoiceItem("stored-item-1")],
  };
}

export function readInvoiceData(): InvoiceData {
  try {
    const stored = window.localStorage.getItem(INVOICE_DATA_KEY);
    return stored ? normalizeInvoiceData(JSON.parse(stored)) : initialInvoiceData();
  } catch {
    return initialInvoiceData();
  }
}

export function readInvoiceMode(): DocumentMode {
  try {
    const stored = window.localStorage.getItem(INVOICE_MODE_KEY);
    return stored === "invoice" ? "invoice" : "nota";
  } catch {
    return "nota";
  }
}

export function readInvoiceCounter(): number {
  try {
    const stored = Number(window.localStorage.getItem(INVOICE_COUNTER_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 1;
  } catch {
    return 1;
  }
}
