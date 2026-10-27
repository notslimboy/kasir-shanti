import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";

import { Card, Pill } from "@/components/ui/card";
import { Toast, useToast } from "@/components/ui/toast";
import { Memuat } from "@/components/ui/memuat";
import { PageHeader, Tabs, inputClass } from "@/components/ui/kit";
import { SheetBawah } from "@/components/ui/sheet-bawah";
import { ItemDaftar } from "@/components/list-motion";
import { getAccessToken } from "@/supabase/client";
import { bacaCacheKlien, dgnCacheKlien, segarkanKlien } from "@/lib/itsfood-api";
import { rupiah } from "@/lib/format";
import type { ItsfoodProduct, ItsfoodProductDetail } from "@/lib/itsfood";

/* ==========================================================================
   Produk Itsfood (/itsfood-produk) — daftar produk dari portal supplier.
   Read-only: list + side-by-side detail. Tidak ada create/edit/accept.
   Visual style: Card, PageHeader, inputClass, Pill, rupiah, dark/light
   tokens — sama dengan halaman Menu / dashboard.
   ========================================================================== */

/** Sumber data mentah — cache kunci "products" (kanonik). */
interface DataProducts {
  products: ItsfoodProduct[];
}

async function tarikProduk(): Promise<DataProducts> {
  const res = await fetch("/api/itsfood/products", {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return { products: json.products as ItsfoodProduct[] };
}

async function apiProduk(paksa = false): Promise<DataProducts> {
  return dgnCacheKlien("products", tarikProduk, { paksa });
}

function bacaProdukCache(): ItsfoodProduct[] | null {
  const c = bacaCacheKlien<DataProducts>("products");
  if (!c || !Array.isArray(c.products)) return null;
  return c.products;
}

async function apiDetailProduk(id: string): Promise<ItsfoodProductDetail> {
  const res = await fetch(`/api/itsfood/products?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json.detail as ItsfoodProductDetail;
}

/** Tone pill status produk — netral untuk daftar portal. */
function toneStatusProduk(status: string): "success" | "warning" | "neutral" {
  const s = status.toLowerCase();
  if (s.includes("aktif") || s.includes("active") || s.includes("publish")) return "success";
  if (s.includes("nonaktif") || s.includes("inactive") || s.includes("draft")) return "neutral";
  return "neutral";
}

function formatHargaDetail(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? rupiah(numeric) : value;
}

export function ItsfoodProdukPage() {
  const [data, setData] = useState<ItsfoodProduct[] | null>(() => bacaProdukCache());
  const [memuat, setMemuat] = useState(() => !bacaProdukCache());
  const [galat, setGalat] = useState("");
  const [q, setQ] = useState("");
  const [kategori, setKategori] = useState("semua");
  const [sel, setSel] = useState<ItsfoodProduct | null>(null);
  const [detail, setDetail] = useState<ItsfoodProductDetail | null>(null);
  const [detailMemuat, setDetailMemuat] = useState(false);
  const [detailGalat, setDetailGalat] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [toast, setToast] = useToast();
  const detailRequest = useRef(0);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const muat = useCallback(
    async (paksa = false) => {
      setGalat("");
      if (!paksa) {
        const cached = bacaProdukCache();
        if (cached) {
          setData(cached);
          setMemuat(false);
          void segarkanKlien("products", tarikProduk)
            .then((hasil) => setData(hasil.products))
            .catch(() => {});
          return;
        }
      }
      setMemuat(true);
      setToast({ tone: "info", spin: true, text: "Menarik daftar produk dari portal…" });
      try {
        const hasil = await apiProduk(paksa);
        setData(hasil.products);
      } catch (e) {
        setGalat(e instanceof Error ? e.message : "Gagal memuat produk");
      } finally {
        setMemuat(false);
        setToast(null);
      }
    },
    [setToast],
  );

  useEffect(() => {
    void muat();
  }, [muat]);

  const kategoriProduk = useMemo(() => {
    const jumlah = new Map<string, number>();
    for (const produk of data ?? []) {
      const nilai = produk.category || "Tanpa Kategori";
      jumlah.set(nilai, (jumlah.get(nilai) ?? 0) + 1);
    }
    return [...jumlah.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "id-ID"))
      .map(([id, count]) => ({ id, label: id, count }));
  }, [data]);

  const list = useMemo(
    () =>
      (data ?? []).filter((p) => {
        const kategoriProduk = p.category || "Tanpa Kategori";
        return (
          (kategori === "semua" || kategoriProduk === kategori) &&
          (q === "" || p.id.includes(q) || p.name.toLowerCase().includes(q.toLowerCase()))
        );
      }),
    [data, q, kategori],
  );

  const bukaDetail = async (p: ItsfoodProduct) => {
    const request = ++detailRequest.current;
    setSel(p);
    setDetail(null);
    setDetailGalat(false);
    setDetailMemuat(true);
    try {
      const hasil = await apiDetailProduk(p.id);
      if (request === detailRequest.current) setDetail(hasil);
    } catch {
      if (request === detailRequest.current) setDetailGalat(true);
    } finally {
      if (request === detailRequest.current) setDetailMemuat(false);
    }
  };

  const renderDetailBody = (layout: "panel" | "drawer") =>
    !sel ? (
      <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-input px-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">Pilih produk untuk melihat detail</p>
      </div>
    ) : detailMemuat ? (
      <Memuat teks={`Memuat detail produk #${sel.id}…`} />
    ) : detailGalat ? (
      <div className="grid min-h-48 place-items-center text-center">
        <div>
          <p className="text-sm font-medium text-destructive">Detail gagal dimuat.</p>
          <button
            onClick={() => void bukaDetail(sel)}
            className="mt-3 rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            Coba lagi
          </button>
        </div>
      </div>
    ) : detail ? (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div>
            <div className="text-xl font-bold tabular-nums text-foreground">
              {formatHargaDetail(detail.cogs) || <span className="text-muted-foreground">—</span>}
            </div>
            <div className="mt-0.5 text-xs font-medium text-muted-foreground">Harga Vendor</div>
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
            {detail.status.trim() ? (
              <Pill tone={toneStatusProduk(detail.status)}>{detail.status}</Pill>
            ) : (
              <span className="text-sm font-medium text-muted-foreground">—</span>
            )}
          </div>
        </div>

        <dl className={`grid grid-cols-1 gap-x-6 gap-y-3.5 ${layout === "panel" ? "xl:grid-cols-2" : ""}`}>
          {([
            ["Nama", detail.name],
            ["Supplier", detail.supplier],
            ["Kategori", detail.category],
            ["Deskripsi", detail.description],
            ["Dibuat", detail.createdAt],
            ["Harga", formatHargaDetail(detail.price)],
            ["Min. Order", detail.minOrder],
            ["Max. Order", detail.maxOrder],
            ["Pre-order (hari)", detail.preOrderDays],
            ["Pre-order (jam)", detail.preOrderHours],
            ["Tag", detail.tags],
          ] as [string, string][]).map(([label, value]) => {
            const kosong = !value.trim();
            const harga = label === "Harga";
            return (
              <div key={label} className={label === "Deskripsi" ? "xl:col-span-2" : "min-w-0"}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd
                  className={
                    "mt-1 break-words text-sm font-medium " +
                    (kosong ? "text-muted-foreground" : "text-foreground") +
                    (harga ? " tabular-nums" : "")
                  }
                >
                  {kosong ? "—" : value}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    ) : null;

  return (
    <div>
      <PageHeader
        title="Produk Itsfood"
        sub="Daftar produk dari portal supplier."
        action={
          <button
            onClick={() => void muat(true)}
            className="h-9 rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
            disabled={memuat}
          >
            {memuat ? "Memuat..." : "Muat ulang"}
          </button>
        }
      />

      {galat && (
        <div className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {galat}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,380px)_auto]">
        <div className="min-w-0">
          <div className="mb-3 space-y-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari ID atau nama produk…"
              className={inputClass}
            />
            <Tabs
              value={kategori}
              onChange={setKategori}
              items={[{ id: "semua", label: "Semua", count: data?.length ?? 0 }, ...kategoriProduk]}
            />
          </div>

          {memuat && !data ? (
            <Card><Memuat teks="Memuat daftar produk…" /></Card>
          ) : list.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-input py-12 text-center">
              <p className="text-sm font-semibold text-muted-foreground">
                {data === null
                  ? "Produk belum dimuat"
                  : q || kategori !== "semua"
                    ? "Produk tidak ditemukan"
                    : "Belum ada produk"}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {list.map((p, i) => {
                    const aktif = sel?.id === p.id;
                    return (
                      <ItemDaftar key={p.id} i={i} aktif={q.trim() !== "" || kategori !== "semua"}>
                        <button
                          type="button"
                          onClick={() => void bukaDetail(p)}
                          aria-pressed={aktif}
                          className={
                            "w-full rounded-2xl p-3.5 text-left transition-all " +
                            (aktif
                              ? "bg-sidebar text-sidebar-foreground shadow-card ring-2 ring-primary"
                              : "bg-card shadow-card hover:bg-accent/40")
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{p.name || "Produk tanpa nama"}</div>
                              <div className={"mt-0.5 truncate text-xs " + (aktif ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
                                #{p.id} · {p.category || "Tanpa Kategori"}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-bold tabular-nums">{p.price || "—"}</div>
                              <div className={"mt-0.5 text-[11px] " + (aktif ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
                                Vendor {p.cogs || "—"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <Pill tone={toneStatusProduk(p.status)}>{p.status || "—"}</Pill>
                            <span className={"text-[11px] " + (aktif ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
                              {p.createdAt || "Tanggal tidak tersedia"}
                            </span>
                          </div>
                        </button>
                      </ItemDaftar>
                    );
                  })}
                </AnimatePresence>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{list.length} produk · pilih produk untuk melihat detail</p>
            </>
          )}
        </div>

        {!isMobile && (
          <Card title={sel ? sel.name : "Detail produk"} className="min-w-0 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-5rem)] xl:overflow-y-auto">
            {renderDetailBody("panel")}
          </Card>
        )}
      </div>

      {isMobile && (
        <SheetBawah
          open={isMobile && sel !== null}
          onClose={() => setSel(null)}
          title={sel ? sel.name : "Detail produk"}
          subtitle={sel?.category || "Produk Itsfood"}
          maxH="88dvh"
        >
          {renderDetailBody("drawer")}
        </SheetBawah>
      )}

      <Toast toast={toast} posisi="atas-tengah" />
    </div>
  );
}
