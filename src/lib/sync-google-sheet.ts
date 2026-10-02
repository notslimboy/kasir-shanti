/* ==========================================================================
   Sinkron produk dari Google Sheet ke Supabase.

   Port dari `script.js`:buildGoogleSheetCsvUrl + fetchGoogleSheetRows +
   applyInventoryRows, tapi dengan dedupe bawaan (produk kembar digabung
   SEBELUM ditulis ke Supabase, bukan hanya saat dibaca) dan kategori
   diisi konsisten.

   BUG LAMA YANG DIPERBAIKI:
     - "Impor dari Google Sheet menyalin baris yang sama berkali-kali"
       → dedupe by nama + harga sebelum upsert
     - "Impor dari Google Sheet mengisi kategori hanya sebagian baris"
       → kategori dari baris pertama (terisi) menang, sisanya diabaikan

   TIDAK ADA tombol manual. Sinkron dijalankan otomatis saat pengguna
   membuka halaman /kasir atau /menu, dan saat jendela mendapat fokus/
   visibilitas.
   ========================================================================== */

import { headerRest, SUPABASE_URL } from "@/supabase/client";
import type { ProductRow } from "@/supabase/types";
import { cacheHapus } from "@/lib/cache-db";
import { tandaiProdukStale } from "@/lib/data-source-signal";

/* -------------------------------------------------------------------------
   Konfigurasi
   ---------------------------------------------------------------------- */

const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/183BZtWGEj0JRE7qjTk1jXBnVFbz_oMti7tR2dkisJsc/edit?gid=0#gid=0";

const DEFAULT_SHEET_NAME = "Menu";

const STORAGE_KEY_URL = "sync-google-sheet:url";
const STORAGE_KEY_NAME = "sync-google-sheet:name";

/* -------------------------------------------------------------------------
   State modul (bukan state global aplikasi)
   ---------------------------------------------------------------------- */

/** Mencegah dua sinkron berjalan bersamaan. */
let syncInFlight = false;

/** Hash CSV terakhir yang berhasil diproses — kalau sheet tidak berubah
    sejak terakhir, sinkron dilewati. */
let lastCsvHash: string | null = null;

/** Hasil sinkron terakhir — dipakai DataBadge untuk info cepat. */
let lastResult: SyncResult | null = null;

/** Waktu terakhir sinkron selesai — mencegah pemicu beruntun (< 10 detik). */
let lastSyncCompletedAt = 0;

/* -------------------------------------------------------------------------
   Tipe hasil
   ---------------------------------------------------------------------- */

export type SyncResult = {
  /** Produk baru dibuat. */
  created: number;
  /** Produk yang sudah ada diperbarui. */
  updated: number;
  /** Baris CSV yang dilewati (tanpa nama / harga <= 0). */
  skipped: number;
  /** Baris duplikat dalam sheet yang digabung jadi satu produk. */
  duplicates: number;
  /** Produk lama yang sumbernya Google Sheet dan tidak lagi ada di sheet.
      Dihapus supaya sheet benar-benar jadi sumber kebenaran. */
  removed: number;
  /** Nama produk yang dihapus — ditampilkan supaya bisa dicek ulang. */
  removedNames?: string[];
  /** Waktu eksekusi. */
  at: Date;
  /** Ada error? */
  error?: string;
};

export function getLastSyncResult(): SyncResult | null {
  return lastResult;
}

/* -------------------------------------------------------------------------
   Pengaturan sheet (disimpan di localStorage)
   ---------------------------------------------------------------------- */

export function getSheetUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_URL) ?? DEFAULT_SHEET_URL;
  } catch {
    return DEFAULT_SHEET_URL;
  }
}

export function setSheetUrl(url: string): void {
  try {
    if (url && url !== DEFAULT_SHEET_URL) localStorage.setItem(STORAGE_KEY_URL, url);
    else localStorage.removeItem(STORAGE_KEY_URL);
  } catch {
    // penyimpanan lokal mungkin tidak tersedia (sandbox)
  }
}

export function getSheetName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_NAME) ?? DEFAULT_SHEET_NAME;
  } catch {
    return DEFAULT_SHEET_NAME;
  }
}

export function setSheetName(name: string): void {
  try {
    if (name && name !== DEFAULT_SHEET_NAME) localStorage.setItem(STORAGE_KEY_NAME, name);
    else localStorage.removeItem(STORAGE_KEY_NAME);
  } catch {
    // penyimpanan lokal mungkin tidak tersedia (sandbox)
  }
}

/* -------------------------------------------------------------------------
   URL CSV dari link Google Sheet
   -------------------------------------------------------------------------
   Port dari `buildGoogleSheetCsvUrl` (script.js baris 12587).
   ---------------------------------------------------------------------- */

export function buildGoogleSheetCsvUrl(rawUrl: string, sheetName?: string): string {
  const value = rawUrl.trim();
  if (!value) throw new Error("Tempel link Google Sheet dulu.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Link Google Sheet belum valid.");
  }

  const isGoogleSheet = url.hostname.includes("docs.google.com") && url.pathname.includes("/spreadsheets/");
  if (!isGoogleSheet) return value;

  // /pubhtml → /pub?output=csv
  if (url.pathname.endsWith("/pubhtml")) {
    url.pathname = url.pathname.replace(/\/pubhtml$/, "/pub");
    url.searchParams.set("output", "csv");
    return url.toString();
  }

  // Udah CSV?
  if (url.searchParams.get("output") === "csv" || url.searchParams.get("tqx")?.includes("out:csv")) {
    return url.toString();
  }

  const idMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!idMatch) throw new Error("ID Google Sheet tidak terbaca dari link itu.");

  const gidFromHash = url.hash.match(/gid=(\d+)/)?.[1];
  const gid = url.searchParams.get("gid") || gidFromHash;
  const csvUrl = new URL(`https://docs.google.com/spreadsheets/d/${idMatch[1]}/gviz/tq`);
  csvUrl.searchParams.set("tqx", "out:csv");

  if (sheetName?.trim()) {
    csvUrl.searchParams.set("sheet", sheetName.trim());
  } else if (gid) {
    csvUrl.searchParams.set("gid", gid);
  }

  return csvUrl.toString();
}

/* -------------------------------------------------------------------------
   Parsing CSV
   -------------------------------------------------------------------------
   Fungsi split + parser sederhana, port dari parseDelimited (script.js:12474)
   tapi tanpa dependensi ke state.columns — kolom dideteksi otomatis.
   ---------------------------------------------------------------------- */

function normalizeKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function detectDelimiter(firstLine: string): string {
  return firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
}

/** Cari header pertama yang cocok dengan salah satu kata kunci. */
function findHeader(headers: string[], ...keywords: string[]): string | null {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeKey(h) }));
  for (const keyword of keywords) {
    const kn = normalizeKey(keyword);
    for (const h of normalized) {
      if (h.norm === kn) return h.raw;
    }
  }
  return null;
}

export function parseSheetCsv(text: string): Record<string, string>[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((line) => splitCsvLine(line, delimiter));
  const headers = rows.shift()!.map((h) => h.trim());

  return rows
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => {
      const record: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = (i < row.length ? row[i] : "").trim();
      }
      return record;
    });
}

/* -------------------------------------------------------------------------
   Ambil baris dari Google Sheet (via URL CSV)
   ---------------------------------------------------------------------- */

export async function fetchGoogleSheetRows(): Promise<Record<string, string>[]> {
  if (!navigator.onLine) {
    throw new Error("Perangkat sedang offline. Data barang terakhir tetap dipakai.");
  }

  const csvUrl = buildGoogleSheetCsvUrl(getSheetUrl(), getSheetName());
  const response = await fetch(csvUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      "Google Sheet tidak bisa dibuka. Pastikan link bisa dilihat publik atau sudah dipublikasikan sebagai CSV.",
    );
  }

  const text = await response.text();
  if (/^\s*</.test(text)) {
    throw new Error("Google mengirim halaman web, bukan CSV. Publikasikan sheet sebagai CSV atau cek nama tab.");
  }

  return parseSheetCsv(text);
}

/* -------------------------------------------------------------------------
   Dedupe baris sheet: gabung baris dengan nama+harga sama.
   ---------------------------------------------------------------------- */

export type CanonicalProduct = {
  name: string;
  price: number;
  stock: number;
  stockUnlimited: boolean;
  sku: string;
  category: string;
  aliases: string[];
};

/** Parse angka dari string CSV — port parseMoney. */
function parseMoney(value: string): number {
  const cleaned = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Parse nilai stok — cek "∞" / "unlimited" dll. */
function parseStockInfo(value: string): { stock: number; stockUnlimited: boolean } {
  const norm = normalizeKey(value);
  const unlimitedWords = ["unlimited", "bebas", "tanpabatas", "tidakterbatas", "infinite"];
  const stockUnlimited = norm === "∞" || unlimitedWords.some((w) => norm.includes(normalizeKey(w)));
  return {
    stock: stockUnlimited ? 0 : parseMoney(value),
    stockUnlimited,
  };
}

/** Parse daftar alias dari string (koma atau newline sebagai pemisah). */
function parseAliasList(value: string): string[] {
  if (!value || !value.trim()) return [];
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Gabung daftar alias — unik, urut. */
function mergeAliasLists(...values: (string | string[])[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (Array.isArray(v)) {
      for (const s of v) if (s) set.add(s.trim().toLowerCase());
    } else if (v) {
      for (const s of parseAliasList(v)) if (s) set.add(s.trim().toLowerCase());
    }
  }
  return [...set];
}

/**
 * Ubah baris CSV mentah → daftar produk kanonis (sudah di-dedupe).
 *
 * Dua baris dianggap produk sama kalau:
 *   - SKU sama (tidak kosong)
 *   - ATAU nama (normalized) + harga sama
 *
 * Kategori diisi dari baris pertama yang punya kategori (bukan string kosong).
 * Alias digabung dari semua baris.
 */
export function rowsToCanonicalProducts(rows: Record<string, string>[]): {
  products: CanonicalProduct[];
  skipped: number;
  duplicates: number;
} {
  // Petakan kolom dari header CSV
  const nameCol = findHeader(Object.keys(rows[0] ?? {}), "name", "nama", "menu", "product") ?? "name";
  const priceCol = findHeader(Object.keys(rows[0] ?? {}), "price", "harga", "cost") ?? "price";
  const stockCol = findHeader(Object.keys(rows[0] ?? {}), "stock", "stok", "qty", "quantity");
  const skuCol = findHeader(Object.keys(rows[0] ?? {}), "sku", "code", "kode");
  const categoryCol = findHeader(
    Object.keys(rows[0] ?? {}),
    "kategori",
    "category",
    "jenis",
    "type",
  );
  const aliasCol = findHeader(
    Object.keys(rows[0] ?? {}),
    "alias",
    "aliases",
    "aliasmenu",
    "alias_menu",
    "namaalias",
    "nama_alias",
  );

  // auto-detect the actual column name we'll use
  const getCol = (row: Record<string, string>, col: string | null): string =>
    col ? (row[col] ?? "") : "";

  const map = new Map<string, CanonicalProduct>();
  let skipped = 0;
  let duplicates = 0;

  const TANPA_KATEGORI = "Tanpa Kategori";
  const kosong = (v: string) => v.trim() === "" || v.trim() === TANPA_KATEGORI;
  const gabungKategori = (a: string, b: string): string => kosong(a) ? b.trim() : a;

  for (const row of rows) {
    const nameRaw = getCol(row, nameCol);
    const name = nameRaw.trim();
    const price = parseMoney(getCol(row, priceCol));

    if (!name || price <= 0) {
      skipped++;
      continue;
    }

    const stockInfo = stockCol ? parseStockInfo(getCol(row, stockCol)) : { stock: 0, stockUnlimited: true };
    const sku = getCol(row, skuCol).trim().toLowerCase();
    const category = categoryCol ? getCol(row, categoryCol).trim() : "";
    const aliases = aliasCol ? parseAliasList(getCol(row, aliasCol)) : [];

    // Kunci identitas: SKU atau nama+price
    const key = sku ? `sku:${normalizeKey(sku)}` : `menu:${normalizeKey(name)}|harga:${price}`;

    const existing = map.get(key);
    if (existing) {
      duplicates++;
      // Gabung kategori (yang terisi duluan)
      existing.category = gabungKategori(existing.category, category);
      // Gabung alias
      existing.aliases = mergeAliasLists(existing.aliases, aliases);
      // SKU: kalau existing belum punya SKU tapi baris ini punya, perbarui
      if (!existing.sku && sku) existing.sku = sku;
      continue;
    }

    map.set(key, {
      name,
      price,
      stock: stockInfo.stock,
      stockUnlimited: stockInfo.stockUnlimited,
      sku,
      category: category || TANPA_KATEGORI,
      aliases,
    });
  }

  return {
    products: [...map.values()],
    skipped,
    duplicates,
  };
}

/* -------------------------------------------------------------------------
   Core sinkron
   ---------------------------------------------------------------------- */

/** client_id baru. */
function buatClientId(): string {
  return crypto.randomUUID();
}

/** Ambil semua produk dari Supabase untuk dicocokkan.
    (Reuse pola dari live.ts tapi pake fetch langsung.) */
async function ambilSemuaProduk(): Promise<ProductRow[]> {
  const hasil: ProductRow[] = [];
  const UKURAN = 1000;
  let mulai = 0;

  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/products`);
    url.searchParams.set("select", "id,client_id,sku,name,price,stock,stock_unlimited,category,aliases,source,updated_at");
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("offset", String(mulai));
    url.searchParams.set("limit", String(UKURAN));

    const r = await fetch(url, {
      headers: { ...headerRest(), Range: `${mulai}-${mulai + UKURAN - 1}` },
    });
    if (!r.ok) throw new Error(`products sync: HTTP ${r.status}`);

    const halaman = (await r.json()) as ProductRow[];
    hasil.push(...halaman);
    mulai += UKURAN;
    if (halaman.length < UKURAN) break;
    if (mulai > 200_000) break;
  }

  return hasil;
}

/** Sederhana hash string (FNV-1a 32-bit) untuk ngecek perubahan CSV. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) % 0xffffffff;
  }
  return hash.toString(36);
}

/** Pesan error dari PostgREST.
 *
 *  HTTP 400 tanpa body cumaMAOUNYIkan "HTTP 400" — penyebabnya (mis.
 *  pelanggaran NOT NULL) ada di field `message` dan hanya bisa dilihat dari
 *  body. Stesen wajib ikut disertakan, dipangkas supaya tidakronic memenuhi
 *  baris status. */
async function pesanRelas(r: Response, aksi: string): Promise<string> {
  const body = (await r.text()).slice(0, 160).replace(/\s+/g, " ").trim();
  return body
    ? `Gagal ${aksi}: HTTP ${r.status} — ${body}`
    : `Gagal ${aksi}: HTTP ${r.status}`;
}

/** Identitas produk: SKU kalau ada, kalau tidak nama + harga. Sama dengan
 *  cara `upsertProduk` mencari pasangan existing. */
function kunciIdentitas(nama: string, harga: number, sku: string): string[] {
  const kunci: string[] = [];
  if (sku) kunci.push(`sku:${normalizeKey(sku)}`);
  kunci.push(`name:${normalizeKey(nama)}|price:${harga}`);
  return kunci;
}

/**
 * Hapus produk yang bersumber dari Google Sheet tapi tidak ada lagi di sheet.
 *
 * Sheet diperlakukan sebagai sumber kebenaran: baris yang dihapus dari sheet
 * harus hilang dari aplikasi juga. Hanya `source="google"` yang dihapus —
 * produk manual (source "manual" atau kosong) tidak pernah tersentuh.
 *
 * Tabel products tidak punya kolom `active`, jadi ini hard delete dan tidak
 * bisa dibatalkan. Karena itu pemanggilnya wajib memastikan sheet memang
 * berisi data (products.length > 0) sebelum fungsi ini dipanggil.
 */
async function hapusProdukYatim(
  products: CanonicalProduct[],
  existingRows: ProductRow[],
): Promise<{ removed: number; removedNames: string[] }> {
  const masihDiSheet = new Set<string>();
  for (const p of products) {
    for (const k of kunciIdentitas(p.name, p.price, p.sku)) masihDiSheet.add(k);
  }

  const yatim = existingRows.filter(
    (r) => r.source === "google" && !kunciIdentitas(r.name, r.price, r.sku).some((k) => masihDiSheet.has(k)),
  );
  if (yatim.length === 0) return { removed: 0, removedNames: [] };

  const headers = { ...headerRest(), "Content-Type": "application/json", Prefer: "return=minimal" };
  const gagal: string[] = [];
  let removed = 0;

  // Dihapus per batch supaya URL tidak melewati batas panjang.
  const UKURAN_BATCH = 100;
  for (let i = 0; i < yatim.length; i += UKURAN_BATCH) {
    const potong = yatim.slice(i, i + UKURAN_BATCH);
    const url = new URL(`${SUPABASE_URL}/rest/v1/products`);
    url.searchParams.set("id", `in.(${potong.map((r) => r.id).join(",")})`);
    const resp = await fetch(url, { method: "DELETE", headers });
    if (!resp.ok) {
      gagal.push(await pesanRelas(resp, "menghapus"));
      continue;
    }
    removed += potong.length;
  }

  if (gagal.length > 0) {
    throw new Error(`${removed} dihapus, ${gagal.length} batch gagal: ${gagal.join("; ")}`);
  }
  return { removed, removedNames: yatim.map((r) => r.name) };
}

/** Tulis produk ke Supabase (POST jika baru, PATCH jika sudah ada). */
async function upsertProduk(
  produk: CanonicalProduct,
  existing: Map<string, { row: ProductRow; normalizedName: string }>,
): Promise<"created" | "updated"> {
  const headers = {
    ...headerRest(),
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  // Cari existing: SKU dulu, lalu nama+price
  let match: ProductRow | undefined;
  if (produk.sku) {
    match = existing.get(`sku:${produk.sku}`)?.row;
  }
  if (!match) {
    const normName = normalizeKey(produk.name);
    for (const [, v] of existing) {
      if (v.normalizedName === normName && v.row.price === produk.price) {
        match = v.row;
        break;
      }
    }
  }

  const now = new Date().toISOString();
  /* sku, category, dan aliases semuanya NOT NULL di tabel products.
     Kolom kosong ditulis sebagai string kosong, bukan null — null memicu
     23502 dan PATCH ditolak. ("Nasi Putih" di database memang punya
     sku="", category="Lainnya", aliases="".) Pembaca di sisi UI sudah
     menangani string kosong: kategoriProduk() di live-mappers mengubahnya
     kembali jadi "Tanpa Kategori", dan alias kosong tidak pernah tampil. */
  const body = {
    name: produk.name,
    price: produk.price,
    stock: produk.stock,
    stock_unlimited: produk.stockUnlimited ? 1 : 0,
    sku: produk.sku || "",
    category: produk.category === "Tanpa Kategori" ? "" : produk.category,
    aliases: produk.aliases.length > 0 ? JSON.stringify(produk.aliases) : "",
    source: "google",
    updated_at: now,
  };

  if (match) {
    // UPDATE (PATCH)
    const url = new URL(`${SUPABASE_URL}/rest/v1/products`);
    url.searchParams.set("id", `eq.${match.id}`);
    const r = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await pesanRelas(r, `memperbarui "${produk.name}"`));
    return "updated";
  }

  // CREATE (POST)
  // products hanya punya kolom: id, client_id, sku, name, price, stock,
  // stock_unlimited, category, aliases, source, updated_at. Tidak ada
  // created_at — mengirim kolom itu membalas PGRST204 dan barisnya tidak
  // jadi tersimpan.
  const url = new URL(`${SUPABASE_URL}/rest/v1/products`);
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      client_id: buatClientId(),
      ...body,
    }),
  });
  if (!r.ok) throw new Error(await pesanRelas(r, `membuat "${produk.name}"`));
  return "created";
}

/**
 * Sinkron produk dari Google Sheet ke Supabase.
 *
 * - Dedupe: nama + harga sama → satu produk (SKU juga dipakai sebagai kunci)
 * - Kategori diisi dari baris pertama yang punya kategori
 * - Guard in-flight: cegah tumpukan sinkron
 * - Hash CSV: lewati kalau konten sheet tidak berubah sejak terakhir
 */
export async function syncProductsFromGoogleSheet(): Promise<SyncResult> {
  const mulai = new Date();

  if (syncInFlight) {
    return { created: 0, updated: 0, skipped: 0, duplicates: 0, removed: 0, at: mulai, error: "Sinkron sebelumnya masih berjalan" };
  }

  syncInFlight = true;
  lastResult = null;

  try {
    if (!navigator.onLine) {
      throw new Error("Perangkat offline.");
    }

    // 1. Fetch CSV
    const csvUrl = buildGoogleSheetCsvUrl(getSheetUrl(), getSheetName());
    const response = await fetch(csvUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Google Sheet tidak bisa dibuka.");
    }
    const text = await response.text();
    if (/^\s*</.test(text)) {
      throw new Error("Google mengirim halaman web, bukan CSV.");
    }

    // 2. Skip kalau konten CSV tidak berubah
    const csvHash = hashText(text);
    if (csvHash === lastCsvHash) {
      const r: SyncResult = { created: 0, updated: 0, skipped: 0, duplicates: 0, removed: 0, at: new Date() };
      lastResult = r;
      return r;
    }

    // 3. Parse CSV → baris → produk kanonis (deduped)
    const rows = parseSheetCsv(text);
    const { products, skipped, duplicates } = rowsToCanonicalProducts(rows);

    if (products.length === 0) {
      // Semua baris dilewati — jangan update lastCsvHash: sheet mungkin
      // memang sedang kosong, atau format kolom berubah. Yang lebih penting,
      // jangan hapus apa pun: sheet kosong sementara tidak berarti semua menu
      // harus hilang dari aplikasi.
      const r: SyncResult = { created: 0, updated: 0, skipped, duplicates, removed: 0, at: new Date() };
      lastResult = r;
      return r;
    }

    // 4. Ambil produk existing dari Supabase untuk dicocokkan
    const existingRows = await ambilSemuaProduk();
    const existing = new Map<string, { row: ProductRow; normalizedName: string }>();
    for (const r of existingRows) {
      const normName = normalizeKey(r.name);
      if (r.sku) existing.set(`sku:${normalizeKey(r.sku)}`, { row: r, normalizedName: normName });
      // Juga index by nama (untuk fallback matching)
      existing.set(`name:${normName}|price:${r.price}`, { row: r, normalizedName: normName });
    }

    // 5. Upsert tiap produk
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const p of products) {
      try {
        const result = await upsertProduk(p, existing);
        if (result === "created") created++;
        else updated++;
      } catch (e) {
        errors.push(`"${p.name}": ${(e as Error).message}`);
      }
    }

    // 6. Hapus produk yang bersumber dari Google Sheet tapi tidak ada lagi
    //    di sheet. Sheet = sumber kebenaran, jadi baris yang dihapus dari
    //    sheet harus hilang dari aplikasi juga.
    //
    //    Hanya source="google" yang tersentuh. Produk manual (source="manual"
    //    atau NULL) tidak pernah dihapus, walau namanya sama — produk manual
    //    dibuat langsung di aplikasi, bukan dari sheet.
    //
    //    Aman karena products.length > 0 sudah dijamin di atas: sheet yang
    //    kebetulan kosong atau balasan Google bukan CSV tidak akan menghapus
    //    seluruh katalog.
    const { removed, removedNames } = await hapusProdukYatim(products, existingRows);

    // 7. Cache hash agar sinkron berikutnya bisa skip kalau sheet tdk berubah
    lastCsvHash = csvHash;

    const r: SyncResult = {
      created,
      updated,
      skipped,
      duplicates,
      removed,
      removedNames,
      at: new Date(),
      // Semua gagalan ditampilkan, bukan 3 pertama. NOT NULL yang sama
      // berlaku untuk tiap baris, jadi 3 pertama sudah cukup untuk
      // menemukan penyebabnya — dan 14 baris yang sama belum jadi
      // informasi baru.
      error: errors.length > 0 ? `${errors.length} gagal: ${errors.join("; ")}` : undefined,
    };
    lastResult = r;
    return r;
  } catch (e) {
    const msg = (e as Error).message;
    const r: SyncResult = { created: 0, updated: 0, skipped: 0, duplicates: 0, removed: 0, at: new Date(), error: msg };
    lastResult = r;
    return r;
  } finally {
    syncInFlight = false;
  }
}

/* -------------------------------------------------------------------------
   Pemicu dari UI (fire-and-forget, silent)
   ---------------------------------------------------------------------- */

let triggerPending = false;

/**
 * Panggil dari halaman /kasir atau /menu saat produk dimuat.
 * Aman dipanggil berkali-kali — hanya satu eksekusi latar.
 * Error ditulis ke console, tidak toast.
 */
export function triggerSyncFromSheet(): void {
  if (triggerPending) return;
  if (!navigator.onLine) return;
  // Cegah pemicu beruntun — jeda 10 detik antar sinkron
  if (Date.now() - lastSyncCompletedAt < 10_000) return;
  // Cek sheet URL ada
  try {
    const url = getSheetUrl();
    if (!url || !url.trim()) return;
  } catch {
    return;
  }

  triggerPending = true;
  void syncProductsFromGoogleSheet().then(async (result) => {
    triggerPending = false;
    lastSyncCompletedAt = Date.now();
    if (result.error) {
      console.warn("[sync-google-sheet]", result.error);
      return;
    }
    if (result.created > 0 || result.updated > 0) {
      console.log(
        `[sync-google-sheet] ${result.created} dibuat, ${result.updated} diperbarui, ` +
          `${result.skipped} dilewati, ${result.duplicates} duplikat digabung`,
      );
    }
    // Buang cache persisted + tandai katalog basi — memaksa pastikanProduk()
    // menarik data terbaru dari Supabase.
    await cacheHapus("produk");
    tandaiProdukStale();
  });
}

/**
 * Setel ulang hash — memaksa sinkron ulang walau konten CSV sama.
 * Dipakai setelah user mengganti URL sheet.
 */
export function resetSyncHash(): void {
  lastCsvHash = null;
  lastResult = null;
  lastSyncCompletedAt = 0;
}

/* -----------------------------------------------------------------------
   Test helpers — tidak dipakai di production.
   ----------------------------------------------------------------------- */

export const __test = {
  get triggerPending(): boolean { return triggerPending; },
  get syncInFlight(): boolean { return syncInFlight; },
  get lastCsvHash(): string | null { return lastCsvHash; },
  set lastCsvHash(v: string | null) { lastCsvHash = v; },
  get lastSyncCompletedAt(): number { return lastSyncCompletedAt; },
  set lastSyncCompletedAt(v: number) { lastSyncCompletedAt = v; },
  resetState(): void {
    triggerPending = false;
    syncInFlight = false;
    lastCsvHash = null;
    lastSyncCompletedAt = 0;
    lastResult = null;
  },
};