import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toPng } from "html-to-image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import logoShanti from "@/assets/logo-shanti-catering.png";
import { Card } from "@/components/ui/card";
import { IkonAksi, IkonHapus } from "@/components/ui/ikon-aksi";
import { Field, PageHeader, Tabs, btnGhost, btnPrimary, inputClass } from "@/components/ui/kit";
import { InputCustomer } from "@/components/ui/input-customer";
import { Modal } from "@/components/ui/modal";
import { useData } from "@/lib/data-source";
import { saranCustomer } from "@/lib/cocok-customer";
import {
  createInvoiceItem,
  formatInvoiceCurrency,
  formatInvoiceDate,
  formatInvoiceNumber,
  formatNumericInput,
  invoiceBalance,
  invoiceLineTotal,
  invoiceTotal,
  normalizeNumericInput,
  numericValue,
  readInvoiceCounter,
  readInvoiceData,
  readInvoiceMode,
  INVOICE_COUNTER_KEY,
  INVOICE_DATA_KEY,
  INVOICE_MODE_KEY,
  type DocumentMode,
  type InvoiceData,
  type InvoiceItem,
} from "@/lib/invoice";
import "@/pages/invoice-nota.css";

const BUSINESS = {
  name: "Shanti Catering",
  address: "Jl. Bhaskara III No. 38",
  phone: "0821 4155 1973",
  serviceInfo: "Menerima Pesanan Nasi Kotak, Kue, Tumpeng, Prasmanan, Coffee Break.",
  paymentInfo: "Pembayaran dapat dilakukan tunai atau transfer.",
  closingNote: "Terima kasih atas kepercayaannya.",
};

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const dateFromIso = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};
const dateToIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const sameDay = (a: Date | null, b: Date) => Boolean(a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
const toCapitalCase = (value: string) => value.trim().toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

function embedLogo(src: string) {
  return fetch(src, { cache: "force-cache" }).then(async (response) => {
    if (!response.ok) throw new Error("Logo tidak dapat dimuat.");
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Logo tidak dapat dibaca."));
      reader.readAsDataURL(blob);
    });
  });
}

function QuantityStepper({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const qty = numericValue(value);
  const setQuantity = (next: number) => onChange(next > 0 ? String(next) : "");

  return (
    <div className="flex h-11 w-full overflow-hidden rounded-xl border border-input bg-card text-foreground transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
      <button
        type="button"
        className="grid h-full w-10 shrink-0 place-items-center text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground/50"
        onClick={() => setQuantity(qty - 1)}
        disabled={qty <= 0}
        aria-label="Kurangi qty"
      >
        <SvgIcon path="M5 12h14" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={normalizeNumericInput(value)}
        onChange={(event) => onChange(normalizeNumericInput(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setQuantity(qty + 1);
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setQuantity(qty - 1);
          }
        }}
        className="h-full min-w-0 flex-1 border-x border-border bg-transparent px-2 text-center text-sm font-bold outline-none figure"
        aria-label="Banyaknya"
        placeholder="0"
      />
      <button
        type="button"
        className="grid h-full w-10 shrink-0 place-items-center text-primary transition-colors hover:bg-muted"
        onClick={() => setQuantity(qty + 1)}
        aria-label="Tambah qty"
      >
        <SvgIcon path="M12 5v14M5 12h14" />
      </button>
    </div>
  );
}

function NumberInput({ value, onChange, prefix }: { value: string; onChange: (value: string) => void; prefix?: boolean }) {
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">Rp</span>}
      <input
        className={inputClass + (prefix ? " pl-10 figure" : " text-center figure")}
        inputMode="numeric"
        value={formatNumericInput(value)}
        onChange={(event) => onChange(normalizeNumericInput(event.target.value))}
        placeholder="0"
      />
    </div>
  );
}

function SvgIcon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={path} /></svg>;
}

export function InvoiceNotaPage() {
  const dataContext = useData();
  const [mode, setMode] = useState<DocumentMode>(readInvoiceMode);
  const [data, setData] = useState<InvoiceData>(readInvoiceData);
  const [counter, setCounter] = useState(readInvoiceCounter);
  const [logo, setLogo] = useState(logoShanti);
  const [logoReady, setLogoReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [konfirmasiHapusSemua, setKonfirmasiHapusSemua] = useState(false);
  const [scale, setScale] = useState(0.5);
  const [fitScale, setFitScale] = useState(0.5);
  const [frameSize, setFrameSize] = useState({ width: 824, height: 1144 });
  const paperRef = useRef<HTMLDivElement>(null);
  const exportFrameRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const number = useMemo(() => data.documentNumber.trim() || formatInvoiceNumber(counter), [counter, data.documentNumber]);
  const total = useMemo(() => invoiceTotal(data, mode), [data, mode]);
  const balance = invoiceBalance(total, data.downPayment);
  const suggestions = useMemo(
    () => saranCustomer(dataContext.customers, dataContext.customerAlias),
    [dataContext.customers, dataContext.customerAlias],
  );
  const paperWidth = mode === "nota" ? 760 : 1120;
  const paperHeight = mode === "nota" ? 1080 : 760;
  const hasInvalidDp = balance.invalidDownPayment;

  useEffect(() => {
    try {
      window.localStorage.setItem(INVOICE_DATA_KEY, JSON.stringify(data));
      window.localStorage.setItem(INVOICE_MODE_KEY, mode);
      window.localStorage.setItem(INVOICE_COUNTER_KEY, String(counter));
    } catch {
      setNotice("Penyimpanan lokal penuh atau tidak tersedia.");
    }
  }, [counter, data, mode]);

  useEffect(() => {
    let active = true;
    void embedLogo(logoShanti).then((dataUrl) => {
      if (!active) return;
      setLogo(dataUrl);
      setLogoReady(true);
    }).catch(() => {
      if (!active) return;
      setLogoReady(true);
      setNotice("Logo tidak dapat disiapkan; coba muat ulang halaman.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const frame = exportFrameRef.current;
    const viewport = previewViewportRef.current;
    if (!frame || !viewport) return;
    const measure = () => {
      const width = frame.offsetWidth;
      const height = frame.offsetHeight;
      if (width > 0 && height > 0) setFrameSize({ width, height });
      const availableWidth = Math.max(240, viewport.clientWidth - 24);
      const nextFit = Math.min(1, availableWidth / Math.max(width, 1));
      setFitScale(nextFit);
      setScale(nextFit);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(viewport);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, paperWidth, paperHeight]);

  const updateData = <K extends keyof InvoiceData>(key: K, value: InvoiceData[K]) => {
    setData((current) => ({ ...current, [key]: value }));
  };
  const updateItem = (id: string, patch: Partial<InvoiceItem>) => {
    setData((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  };
  const addItem = () => setData((current) => ({ ...current, items: [...current.items, createInvoiceItem()] }));
  const clearItems = () => {
    setData((current) => ({ ...current, items: [createInvoiceItem()] }));
    setKonfirmasiHapusSemua(false);
  };
  const hasAnyItem = data.items.some((item) => item.name.trim() || item.quantity || item.price);
  const removeItem = (id: string) => setData((current) => ({
    ...current,
    items: current.items.length === 1 ? current.items : current.items.filter((item) => item.id !== id),
  }));

  const downloadPng = async () => {
    if (!exportFrameRef.current || exporting || hasInvalidDp) return;
    setExporting(true);
    setNotice("");
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(exportFrameRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: "#ffffff" });
      const fileName = `${mode}-${number.replace(/[^a-zA-Z0-9-]+/g, "-")}.png`;
      // Di ponsel, buka share sheet bawaan (WhatsApp, Files, Photos, dll).
      // Kalau Web Share file tidak didukung, jatuh ke unduhan biasa.
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], fileName, { type: "image/png" });
        if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }) && navigator.share) {
          await navigator.share({
            files: [file],
            title: `${mode === "nota" ? "Nota" : "Invoice"} ${number}`,
            text: "Dokumen Shanti Catering",
          });
          setCounter((current) => current + 1);
          setNotice("Menu berbagi dibuka.");
          return;
        }
      } catch (shareError) {
        // Batal dari share sheet bukan kegagalan; jangan tampilkan error.
        if (shareError instanceof DOMException && shareError.name === "AbortError") {
          setNotice("Berbagi dibatalkan.");
          return;
        }
        // Gagal share karena alasan lain: lanjut ke unduhan.
      }
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName;
      link.click();
      setCounter((current) => current + 1);
      setNotice("Gambar dokumen berhasil diunduh.");
    } catch (error) {
      setNotice(error instanceof Error ? `Gagal membuat PNG: ${error.message}` : "Gagal membuat PNG.");
    } finally {
      setExporting(false);
    }
  };

  const documentRows = data.items.filter((item) => item.name.trim() || item.quantity || item.price);
  const dateLabel = formatInvoiceDate(data.date);

  const content = (
    <>
    <div className="invoice-workspace grid min-w-0 gap-4 xl:grid-cols-[minmax(330px,0.9fr)_minmax(0,1.1fr)]">
      <Card className="min-w-0" title="Data dokumen" bodyClassName="space-y-5">
        <section>
          <div className="mb-3">
            <h3 className="text-sm font-semibold">{mode === "nota" ? "Detail nota" : "Detail invoice"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Data tersimpan otomatis di perangkat ini.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={mode === "nota" ? "NOTA No" : "Nomor invoice"}>
              <input className={inputClass} value={data.documentNumber} placeholder={formatInvoiceNumber(counter)} onChange={(event) => updateData("documentNumber", event.target.value)} />
            </Field>
            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tanggal</span>
              <SingleDatePicker value={data.date} onChange={(value) => updateData("date", value)} reducedMotion={Boolean(reducedMotion)} />
            </div>
            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{mode === "nota" ? "Kepada YTH" : "Customer"}</span>
              <InputCustomer value={data.customerName} onChange={(value) => updateData("customerName", value)} saran={suggestions} placeholder="Nama customer" className="invoice-customer-input" label={mode === "nota" ? "Kepada YTH" : "Customer"} />
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Item pesanan</h3><p className="mt-1 text-xs text-muted-foreground">Nama, jumlah, dan harga bisa diisi manual.</p>
          </div>
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {data.items.map((item, index) => (
                <motion.div
                  key={item.id}
                  layout={!reducedMotion}
                  initial={reducedMotion ? false : { opacity: 0, y: -12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                  transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeOut" }}
                  className="rounded-2xl border border-border bg-muted/30 p-3"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Item {index + 1}</span>
                    <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-40" onClick={() => removeItem(item.id)} disabled={data.items.length === 1} aria-label={`Hapus item ${index + 1}`}><SvgIcon path="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3" /></button>
                  </div>
                  <Field label="Nama menu">
                    <input className={inputClass} value={item.name} placeholder="Contoh: Nasi kotak ayam bakar" onChange={(event) => updateItem(item.id, { name: event.target.value })} />
                  </Field>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Banyaknya"><QuantityStepper value={item.quantity} onChange={(value) => updateItem(item.id, { quantity: value })} /></Field>
                    <Field label="Harga satuan"><NumberInput prefix value={item.price} onChange={(value) => updateItem(item.id, { price: value })} /></Field>
                  </div>
                  <div className="mt-3 flex justify-between border-t border-border pt-2.5 text-xs">
                    <span className="text-muted-foreground">Jumlah</span><output className="font-bold figure">{formatInvoiceCurrency(invoiceLineTotal(item))}</output>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={addItem}
              className={btnPrimary + " h-11 shrink-0 whitespace-nowrap text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2"}
            >
              <SvgIcon path="M12 5v14M5 12h14" className="h-5 w-5" />
              Tambah item
            </button>
            <IkonAksi label="Hapus semua item" nada="hapus" ukuran="md" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2" onClick={() => setKonfirmasiHapusSemua(true)} disabled={!hasAnyItem && data.items.length === 1}><IkonHapus /></IkonAksi>
          </div>
        </section>

        <section className="rounded-2xl bg-muted/50 p-3">
          <div className="mb-3"><h3 className="text-sm font-semibold">{mode === "nota" ? "Biaya & pembayaran" : "Pembayaran"}</h3><p className="mt-1 text-xs text-muted-foreground">Down Payment (DP) bersifat opsional.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {mode === "nota" && <>
              <Field label="Ongkir"><NumberInput prefix value={data.deliveryFee} onChange={(value) => updateData("deliveryFee", value)} /></Field>
              <Field label="Biaya Service"><NumberInput prefix value={data.serviceFee} onChange={(value) => updateData("serviceFee", value)} /></Field>
            </>}
            <Field label="Down Payment (DP)"><NumberInput prefix value={data.downPayment} onChange={(value) => updateData("downPayment", value)} /></Field>
            <div className="flex min-h-11 flex-col justify-center rounded-xl bg-card px-3 py-2">
              <span className="text-[11px] font-semibold text-muted-foreground">Sisa tagihan</span>
              <output aria-live="polite" className="figure text-sm font-bold">{hasInvalidDp ? "Periksa nominal DP" : formatInvoiceCurrency(balance.remainingBalance)}</output>
            </div>
          </div>
          {hasInvalidDp && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">DP harus lebih kecil dari total tagihan.</p>}
        </section>
        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="font-semibold">Total dokumen</span><output className="figure text-lg font-bold">{formatInvoiceCurrency(total)}</output>
        </div>
      </Card>

      <Card className="min-w-0" title="Preview dokumen" fillBody bodyClassName="flex flex-col" action={<span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{mode === "nota" ? "Portrait" : "Landscape"}</span>}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button type="button" className={btnGhost + " h-9 px-3 text-xs"} onClick={() => setScale((current) => Math.max(0.25, current - 0.08))} aria-label="Perkecil preview">−</button>
            <button type="button" className={btnGhost + " h-9 px-3 text-xs"} onClick={() => setScale(fitScale)}>Sesuaikan</button>
            <button type="button" className={btnGhost + " h-9 px-3 text-xs"} onClick={() => setScale((current) => Math.min(1, current + 0.08))} aria-label="Perbesar preview">+</button>
          </div>
          <button type="button" className={btnPrimary} onClick={() => void downloadPng()} disabled={exporting || !logoReady || hasInvalidDp}>
            <SvgIcon path="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3" />
            {exporting ? "Membuat PNG…" : "Unduh PNG"}
          </button>
        </div>
        {hasInvalidDp && <p className="mb-3 text-xs font-medium text-destructive">Perbaiki DP sebelum mengunduh dokumen.</p>}
        <div ref={previewViewportRef} className={`invoice-preview-scroll${mode === "nota" ? " nota-mode" : ""}`} aria-label="Preview dokumen, dapat digulir">
          <div className="invoice-preview-stage" style={{ width: frameSize.width * scale, height: frameSize.height * scale }}>
            <div className="invoice-preview-scale" style={{ width: frameSize.width, height: frameSize.height, transform: `scale(${scale})` }}>
              <div ref={exportFrameRef} className="export-frame">
                <div ref={paperRef} className={`document-paper ${mode}-paper`}>
                  {mode === "nota" ? (
                    <NotaDocument data={data} number={number} dateLabel={dateLabel} logo={logo} total={total} balance={balance} rows={documentRows} />
                  ) : (
                    <InvoiceDocument data={data} number={number} dateLabel={dateLabel} logo={logo} total={total} balance={balance} rows={documentRows} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        {notice && <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">{notice}</p>}
      </Card>
    </div>
    <Modal
      open={konfirmasiHapusSemua}
      onClose={() => setKonfirmasiHapusSemua(false)}
      title="Hapus semua item?"
      subtitle="Daftar item akan dikosongkan."
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={() => setKonfirmasiHapusSemua(false)} className={btnGhost + " flex-1"}>Batal</button>
          <button type="button" onClick={clearItems} className="h-11 flex-1 rounded-full bg-destructive font-semibold text-white transition-opacity hover:opacity-90">Ya, hapus semua</button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">Semua item di daftar akan dihapus. Nomor dokumen, tanggal, customer, dan pembayaran tetap tersimpan.</p>
    </Modal>
    </>
  );

  return (
    <motion.div
      className="invoice-nota-page mx-auto max-w-[1440px]"
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
    >
      <PageHeader title="Invoice & Nota" sub="Buat nota atau invoice, lalu unduh sebagai gambar." />
      <Tabs value={mode} onChange={(value) => setMode(value as DocumentMode)} className="mb-4" items={[{ id: "nota", label: "Nota" }, { id: "invoice", label: "Invoice" }]} />
      {content}
    </motion.div>
  );
}

function SingleDatePicker({ value, onChange, reducedMotion }: { value: string; onChange: (value: string) => void; reducedMotion: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = dateFromIso(value);
  const [cursor, setCursor] = useState<Date>(() => selected ?? startOfDay(new Date()));
  const [monthGrid, setMonthGrid] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());

  useEffect(() => {
    if (!open) return;
    setCursor(selected ?? startOfDay(new Date()));
    setMonthGrid(false);
  }, [open]); // selected intentionally read at open only

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || monthGrid) return;
    const target = gridRef.current?.querySelector<HTMLElement>(`[data-day="${cursor.toDateString()}"]`);
    target?.focus();
  }, [cursor, monthGrid, open]);

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [cursor]);

  const moveDay = (amount: number) => setCursor((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + amount));
  const moveMonth = (amount: number) => setCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const moveYear = (amount: number) => setCursor((current) => new Date(current.getFullYear() + amount, current.getMonth(), 1));
  const choose = (date: Date) => {
    onChange(dateToIso(date));
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } else if (!monthGrid && event.key === "ArrowLeft") {
      event.preventDefault(); moveDay(-1);
    } else if (!monthGrid && event.key === "ArrowRight") {
      event.preventDefault(); moveDay(1);
    } else if (!monthGrid && event.key === "ArrowUp") {
      event.preventDefault(); moveDay(-7);
    } else if (!monthGrid && event.key === "ArrowDown") {
      event.preventDefault(); moveDay(7);
    } else if (event.key === "PageUp") {
      event.preventDefault(); monthGrid ? moveYear(-1) : moveMonth(-1);
    } else if (event.key === "PageDown") {
      event.preventDefault(); monthGrid ? moveYear(1) : moveMonth(1);
    }
  };

  const triggerLabel = selected
    ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(selected)
    : "Pilih tanggal";

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Pilih tanggal${selected ? `, ${triggerLabel}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-card px-3.5 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 ${open ? "border-ring ring-2 ring-ring/25" : "border-input hover:border-ring"}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <SvgIcon className="h-4 w-4 shrink-0 text-muted-foreground" path="M5 6.5h14v13H5zM5 10h14M8 4v5M16 4v5" />
          <span className="truncate">{triggerLabel}</span>
        </span>
        <SvgIcon className="h-4 w-4 shrink-0 text-muted-foreground" path="m7 10 5 5 5-5" />
      </button>

      <AnimatePresence>
        {open && <motion.div
          role="dialog"
          aria-label="Pilih tanggal"
          initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: reducedMotion ? 0 : 0.15 }}
          className="absolute left-0 z-50 mt-1.5 w-[min(calc(100vw-2rem),21.5rem)] rounded-2xl border border-border bg-popover p-3 shadow-pop"
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label={monthGrid ? "Tahun sebelumnya" : "Bulan sebelumnya"} onClick={() => monthGrid ? moveYear(-1) : moveMonth(-1)} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">‹</button>
            <button type="button" aria-expanded={monthGrid} onClick={() => setMonthGrid((current) => !current)} className="rounded-lg px-3 py-1 text-sm font-bold hover:bg-muted">
              {monthGrid ? cursor.getFullYear() : `${BULAN[cursor.getMonth()]} ${cursor.getFullYear()}`}
            </button>
            <button type="button" aria-label={monthGrid ? "Tahun berikutnya" : "Bulan berikutnya"} onClick={() => monthGrid ? moveYear(1) : moveMonth(1)} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">›</button>
          </div>

          {monthGrid ? (
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Pilih bulan">
              {BULAN.map((month, index) => (
                <button key={month} type="button" aria-pressed={cursor.getMonth() === index} onClick={() => { setCursor(new Date(cursor.getFullYear(), index, 1)); setMonthGrid(false); }} className={`min-h-10 rounded-xl px-2 py-2 text-xs font-semibold transition-colors hover:bg-muted ${cursor.getMonth() === index ? "bg-primary text-primary-foreground" : ""}`}>
                  {month}
                </button>
              ))}
            </div>
          ) : <>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-muted-foreground">
              {HARI.map((day) => <div key={day} className="py-1">{day}</div>)}
            </div>
            <div ref={gridRef} className="mt-0.5 grid grid-cols-7 gap-0.5">
              {days.map((day) => {
                const outside = day.getMonth() !== cursor.getMonth();
                const isSelected = sameDay(selected, day);
                const isToday = sameDay(today, day);
                const isCursor = sameDay(cursor, day);
                return <button
                  key={day.toDateString()}
                  type="button"
                  data-day={day.toDateString()}
                  tabIndex={isCursor ? 0 : -1}
                  aria-pressed={isSelected}
                  aria-label={new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(day)}
                  onClick={() => choose(day)}
                  className={`relative grid h-9 place-items-center rounded-xl text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${outside ? "text-muted-foreground/45" : "hover:bg-muted"} ${isSelected ? "bg-primary font-bold text-primary-foreground hover:bg-primary" : ""} ${isToday && !isSelected ? "border border-ring" : ""}`}
                >
                  {day.getDate()}
                  {isToday && !isSelected && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-ring" />}
                </button>;
              })}
            </div>
          </>}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <button type="button" onClick={() => { onChange(""); setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); }} className="h-9 rounded-full border border-input px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground">Kosongkan</button>
            <button type="button" onClick={() => choose(today)} className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90">Hari ini</button>
          </div>
        </motion.div>}
      </AnimatePresence>
    </div>
  );
}

type DocumentProps = {
  data: InvoiceData;
  number: string;
  dateLabel: string;
  logo: string;
  total: number;
  balance: ReturnType<typeof invoiceBalance>;
  rows: InvoiceItem[];
};

function ContactPill({ compact = false, children, icon }: { compact?: boolean; children: string; icon: "pin" | "phone" }) {
  const iconPath = icon === "pin"
    ? "M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Zm0-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
    : "M7 3h3l2 5-2 1.5a14 14 0 0 0 4.5 4.5L16 12l5 2v3c0 1.1-.9 2-2 2C10 19 5 14 4 5c0-1.1.9-2 2-2Z";
  return <div className={`document-contact-pill ${compact ? "compact" : ""}`}>
    <span><SvgIcon path={iconPath} className={compact ? "h-3 w-3" : "h-4 w-4"} /></span><b>{children}</b>
  </div>;
}

function LogoBlock({ compact = false, logo }: { compact?: boolean; logo: string }) {
  return <div className={`logo-block ${compact ? "compact" : ""}`}>
    <img src={logo} alt="Shanti Catering logo" decoding="sync" loading="eager" />
    <div className="logo-contacts">
      <ContactPill compact={compact} icon="pin">{BUSINESS.address}</ContactPill>
      <ContactPill compact={compact} icon="phone">{BUSINESS.phone}</ContactPill>
    </div>
  </div>;
}

function NotaDocument({ data, number, dateLabel, logo, total, balance, rows }: DocumentProps) {
  const deliveryFee = numericValue(data.deliveryFee);
  const serviceFee = numericValue(data.serviceFee);
  const contentRows: Array<{ type: "item"; item: InvoiceItem } | { type: "delivery" } | { type: "service" }> = [
    ...rows.map((item) => ({ type: "item" as const, item })),
    ...(deliveryFee > 0 ? [{ type: "delivery" as const }] : []),
    ...(serviceFee > 0 ? [{ type: "service" as const }] : []),
  ];
  const paddedRows = Array.from({ length: Math.max(10, contentRows.length) }, (_, index) => contentRows[index] ?? null);

  return <>
    <div className="nota-header">
      <LogoBlock logo={logo} />
      <div className="nota-right">
        <p className="service-info">{BUSINESS.serviceInfo}</p>
        <div className="nota-fields">
          <DocumentLine label="NOTA No" value={number} />
          <DocumentLine label="Tanggal" value={dateLabel} />
          <DocumentLine label="Kepada YTH" value={data.customerName} strong multiline />
        </div>
      </div>
    </div>
    <table className="nota-table">
      <thead><tr><th>BANYAKNYA</th><th>NAMA MENU</th><th>HARGA SATUAN</th><th>JUMLAH</th></tr></thead>
      <tbody>
        {paddedRows.map((row, index) => {
          if (row?.type === "delivery") return <tr key="delivery-fee"><td /><td className="text-left font-bold">Ongkir</td><td /><td>{formatInvoiceCurrency(deliveryFee)}</td></tr>;
          if (row?.type === "service") return <tr key="service-fee"><td /><td className="text-left font-bold">Biaya Service</td><td /><td>{formatInvoiceCurrency(serviceFee)}</td></tr>;
          if (row?.type === "item") return <tr key={row.item.id}><td>{row.item.quantity}</td><td className="text-left">{toCapitalCase(row.item.name)}</td><td>{row.item.price ? formatInvoiceCurrency(numericValue(row.item.price)) : ""}</td><td>{invoiceLineTotal(row.item) > 0 ? formatInvoiceCurrency(invoiceLineTotal(row.item)) : ""}</td></tr>;
          return <tr key={`empty-${index}`}><td /><td /><td /><td /></tr>;
        })}
        {balance.downPayment > 0 ? <>
          <tr className="total-row"><td colSpan={3}>Total Tagihan</td><td>{formatInvoiceCurrency(total)}</td></tr>
          <tr className="total-row"><td colSpan={3}>Down Payment (DP)</td><td>{formatInvoiceCurrency(balance.downPayment)}</td></tr>
          <tr className="total-row"><td colSpan={3}>Sisa Tagihan</td><td>{formatInvoiceCurrency(balance.remainingBalance)}</td></tr>
        </> : <tr className="total-row"><td colSpan={3}>TOTAL</td><td>{formatInvoiceCurrency(total)}</td></tr>}
      </tbody>
    </table>
    <div className="nota-signature"><p>Tanda Terima,</p><span /></div>
  </>;
}

function InvoiceDocument({ data, number, dateLabel, logo, total, balance, rows }: DocumentProps) {
  const invoiceItems = rows.filter((item) => item.name.trim() || item.quantity || item.price);
  return <>
    <div className="invoice-header">
      <LogoBlock compact logo={logo} />
      <div className="invoice-title"><p>INVOICE</p><span>No. {number}</span></div>
    </div>
    <div className="invoice-info">
      <div className="bill-to">
        <p>Bill to</p>
        <strong>{data.customerName}</strong>
        <div>{BUSINESS.closingNote}</div>
      </div>
      <div className="invoice-meta-box">
        <InvoiceMeta label="Tanggal" value={dateLabel} />
        {balance.downPayment > 0 ? <>
          <InvoiceMeta label="Total Tagihan" value={formatInvoiceCurrency(total)} />
          <InvoiceMeta label="Down Payment (DP)" value={formatInvoiceCurrency(balance.downPayment)} />
          <InvoiceMeta label="Sisa Tagihan" value={formatInvoiceCurrency(balance.remainingBalance)} strong />
        </> : <InvoiceMeta label="Total" value={formatInvoiceCurrency(total)} strong />}
        <InvoiceMeta label="Kontak" value={BUSINESS.phone} />
      </div>
    </div>
    <table className="invoice-table">
      <thead><tr><th>Item</th><th>Qty</th><th>Harga</th><th>Jumlah</th></tr></thead>
      <tbody>
        {invoiceItems.map((item) => <tr key={item.id}>
          <td>{item.name ? toCapitalCase(item.name) : "Item"}</td>
          <td>{item.quantity}</td>
          <td>{item.price ? formatInvoiceCurrency(numericValue(item.price)) : ""}</td>
          <td>{invoiceLineTotal(item) > 0 ? formatInvoiceCurrency(invoiceLineTotal(item)) : ""}</td>
        </tr>)}
      </tbody>
    </table>
    <div className="invoice-bottom">
      <div className="payment-info"><p>Payment info</p><div>{BUSINESS.paymentInfo}</div></div>
      <div className="invoice-total-card">
        {balance.downPayment > 0 ? <>
          <div className="invoice-total-row"><span>Total Tagihan</span><span>{formatInvoiceCurrency(total)}</span></div>
          <div className="invoice-total-row"><span>Down Payment (DP)</span><span>{formatInvoiceCurrency(balance.downPayment)}</span></div>
          <div className="invoice-total-final"><span>Sisa Tagihan</span><span>{formatInvoiceCurrency(balance.remainingBalance)}</span></div>
        </> : <>
          <div className="invoice-total-row"><span>Subtotal</span><span>{formatInvoiceCurrency(total)}</span></div>
          <div className="invoice-total-final"><span>Total</span><span>{formatInvoiceCurrency(total)}</span></div>
        </>}
      </div>
    </div>
  </>;
}

function DocumentLine({ label, value, strong = false, multiline = false }: { label: string; value: string; strong?: boolean; multiline?: boolean }) {
  return <div className={`document-line ${multiline ? "multiline" : ""}`}>
    <span>{label}</span><span className={strong ? "strong" : ""}>{value}</span>
  </div>;
}

function InvoiceMeta({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="invoice-meta-row"><span>{label}</span><span className={strong ? "strong" : ""}>{value}</span></div>;
}
