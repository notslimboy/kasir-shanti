/* ==========================================================================
   Itsfood server layer — the only place that talks to supplier.itsfood.id.

   Why a server at all: the portal sends no CORS headers, so the browser
   cannot call it directly. The SPA calls same-origin /api/itsfood/* and
   this module does the scraping on the server.

   Runs in two hosts with the exact same code path:
   - Vercel serverless functions (api/*.ts) in production
   - a Vite dev middleware (vite.config.ts) locally, so `npm run dev`
     keeps working unchanged

   Auth model: "login fresh on every request" (option B). The portal's
   session lives ~2h and its CSRF token never rotates within that window,
   but a fresh login per request needs no state storage — which matters on
   serverless where nothing persists between invocations.
   ========================================================================== */

/* NOTE: relative import, bukan alias `@/`. File ini juga dimuat Vercel
   Functions (api/*.ts), dan compiler Vercel tidak membaca paths alias
   milik Vite. */
import {
  parseBillablesPage,
  parseBillsPage,
  parseHistoryPage,
  parseOrderDetail,
  parseOrdersPage,
  parsePaymentDetail,
  petaBayarDari,
  rekapPembayaranDari,
  type ItsfoodBill,
  type ItsfoodBillable,
  type ItsfoodOrder,
  type ItsfoodOrderDetail,
  type ItsfoodPaymentDetail,
  type ItsfoodPaymentHistory,
  type PetaBayarOrder,
  type RekapPembayaran,
} from "../lib/itsfood";

/* Verifikasi JWT Supabase via REST — TANPA @supabase/supabase-js.
   Function Vercel dulu mati saat init karena dependency itu ikut masuk
   bundle; satu fetch ke /auth/v1/user memberi jawaban yang sama
   (token sah atau tidak) dengan permukaan yang jauh lebih kecil. */

const BASE = "https://supplier.itsfood.id";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */

type Jar = Record<string, string>;

function readSetCookies(res: Response): Jar {
  const jar: Jar = {};
  // Node 18.19+ / undici exposes getSetCookie(); Vercel's runtime has it.
  const list = res.headers.getSetCookie?.() ?? [];
  for (const sc of list) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/* ------------------------------------------------------------------ */
/* Login + session cache                                               */
/* ------------------------------------------------------------------ */

interface Session {
  jar: Jar;
  csrf: string;
}

/** Session dipakai ulang antar request selama masih muda. Portal
    mengakuinya ±2 jam; batas kita 100 menit biar selalu aman. Ini yang
    paling besar pengaruhnya: satu panggilan API tidak lagi selalu
    membayar 2 request login. */
const SESI_MAKSU = 100 * 60_000;
let sesiCache: { session: Session; at: number } | null = null;

/** GET /login (csrf_cookie) → POST /auth/login. Throws on bad credentials
    with the portal's own Indonesian message so the UI can show it. */
export async function loginItsfood(): Promise<Session> {
  const username = process.env.ITSFOOD_USERNAME;
  const password = process.env.ITSFOOD_PASSWORD;
  if (!username || !password) {
    throw new ItsfoodError(
      "ITSFOOD_USERNAME / ITSFOOD_PASSWORD belum diisi di environment",
      500,
    );
  }

  const r1 = await fetch(`${BASE}/login`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  const jar1 = readSetCookies(r1);
  const csrf = jar1.csrf_cookie;
  if (!csrf) throw new ItsfoodError("Gagal mengambil csrf_cookie", 502);

  const body = new URLSearchParams({ username, password, csrf_token: csrf });
  const r2 = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar1),
      Referer: `${BASE}/login`,
    },
    body: body.toString(),
    cache: "no-store",
  });

  let json: { status?: string; message?: string; description?: string } | null = null;
  try {
    json = await r2.json();
  } catch {
    /* error page HTML — handled below */
  }
  if (!json || json.status !== "success") {
    throw new ItsfoodError(
      json?.description || json?.message || `Login itsfood gagal (HTTP ${r2.status})`,
      502,
    );
  }

  const jar = { ...jar1, ...readSetCookies(r2) };
  const session: Session = { jar, csrf };
  sesiCache = { session, at: Date.now() };
  return session;
}

export class ItsfoodError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Orders list                                                         */
/* ------------------------------------------------------------------ */

/** One /orders page fetch. Redirect to /login or an empty document means
    the session did not stick — surfaced as SESSION_EXPIRED for retry. */
async function fetchOrdersPage(
  session: Session,
  params: URLSearchParams,
): Promise<string> {
  const res = await fetch(`${BASE}/orders?${params.toString()}`, {
    headers: {
      "User-Agent": UA,
      Cookie: cookieHeader(session.jar),
    },
    cache: "no-store",
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) throw new ItsfoodError("SESSION_EXPIRED");
  if (!res.ok) throw new ItsfoodError(`HTTP ${res.status} dari /orders`);
  const html = await res.text();
  if (html.length === 0 || html.includes("Login - Itsfood")) {
    throw new ItsfoodError("SESSION_EXPIRED");
  }
  return html;
}

/** Jalankan `fn` dengan session yang masih hidup. Prioritas: cache sesi →
    kalau dibantol portal (SESSION_EXPIRED) login fresh sekali → kalau
    masih dibantol, login LAGI (session yang baru saja dibuat tidak mungkin
    sudah mati; kalau mati itu gangguan portal, dan satu retry wajar). */
async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  if (sesiCache && Date.now() - sesiCache.at < SESI_MAKSU) {
    try {
      return await fn(sesiCache.session);
    } catch (e) {
      if (!(e instanceof ItsfoodError && e.message === "SESSION_EXPIRED")) throw e;
      // session cache bermatemai — jatuh ke login fresh di bawah.
    }
  }
  const session = await loginItsfood();
  try {
    return await fn(session);
  } catch (e) {
    if (e instanceof ItsfoodError && e.message === "SESSION_EXPIRED") {
      const retry = await loginItsfood();
      return await fn(retry);
    }
    throw e;
  }
}

export interface RentangParams {
  /** ISO "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
  /** 1-based, from the UI's month grid (max 6 weeks → 6 is plenty). */
  maxPages?: number;
}

/* ------------------------------------------------------------------ */
/* Data cache (stale-while-revalidate)                                 */
/* ------------------------------------------------------------------ */

interface EntriCache<T> {
  data: T;
  at: number;
  /** Segarkan background yang sedang berjalan — dedup, biar dua request
      bersamaan tidak men-scrape dua kali. */
  segarkan?: Promise<void>;
}

const TTL_ORDERS = 3 * 60_000; // daftar order per rentang
const TTL_PAYMENTS = 5 * 60_000; // billables/bills/history

const cacheOrders = new Map<string, EntriCache<ItsfoodOrder[]>>();
let cachePayments: EntriCache<DataPembayaran> | undefined;

/** Baca cache dengan pola stale-while-revalidate:
    - masih segar      → data langsung, tanpa sentuh portal
    - kedaluwarsa      → data lama dikembalikan SEKARANG, scrape ulang
                         jalan di background (dedup per kunci)
    - belum pernah ada → scrape dan tunggu (load pertama memang bayar
                         harga penuh sekali saja)
    Memori module-level: di Vercel ikut instance function yang hangat, di
    dev server hidup selama proses jalan. */
async function denganCache<T>(
  entri: EntriCache<T> | undefined,
  simpan: (e: EntriCache<T>) => void,
  ttl: number,
  fetcher: () => Promise<T>,
): Promise<{ data: T; stale: boolean; umurDetik: number }> {
  if (entri) {
    const umur = Date.now() - entri.at;
    if (umur < ttl) {
      return { data: entri.data, stale: false, umurDetik: Math.round(umur / 1000) };
    }
    if (!entri.segarkan) {
      entri.segarkan = fetcher()
        .then((data) => simpan({ data, at: Date.now() }))
        .catch(() => {
          /* scrape background gagal — data lama tetap dipakai sampai
             request berikutnya mencoba lagi. */
        })
        .finally(() => {
          entri.segarkan = undefined;
        });
    }
    return {
      data: entri.data,
      stale: true,
      umurDetik: Math.round(umur / 1000),
    };
  }
  const data = await fetcher();
  const e: EntriCache<T> = { data, at: Date.now() };
  simpan(e);
  return { data, stale: false, umurDetik: 0 };
}

/** All orders delivered between from..to (cached). Return value carries
    cache info so the UI can say "data 2 menit lalu" instead of lying. */
export async function ambilOrdersRentang(
  { from, to, maxPages = 20 }: RentangParams,
): Promise<{ data: ItsfoodOrder[]; stale: boolean; umurDetik: number }> {
  const kunci = `${from}|${to}`;
  return denganCache(
    cacheOrders.get(kunci),
    (e) => void cacheOrders.set(kunci, e),
    TTL_ORDERS,
    () => scrapeOrdersRentang({ from, to, maxPages }),
  );
}

async function scrapeOrdersRentang(
  { from, to, maxPages = 20 }: RentangParams,
): Promise<ItsfoodOrder[]> {
  return withSession(async (session) => {
    const out: ItsfoodOrder[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        page: String(page),
        "filters[delivery_date][start_date]": from,
        "filters[delivery_date][end_date]": to,
      });
      const html = await fetchOrdersPage(session, params);
      const orders = parseOrdersPage(html);
      if (orders.length === 0) break;
      out.push(...orders);
      if (orders.length < 10) break; // last page
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* Order detail                                                        */
/* ------------------------------------------------------------------ */

export async function ambilDetailOrder(orderId: string): Promise<ItsfoodOrderDetail> {
  return withSession(async (session) => {
    const res = await fetch(`${BASE}/orders/order/${orderId}`, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
      cache: "no-store",
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      throw new ItsfoodError("SESSION_EXPIRED");
    }
    if (!res.ok) {
      throw new ItsfoodError(`Order #${orderId} tidak bisa dibuka (HTTP ${res.status})`, 404);
    }
    const html = await res.text();
    const detail = parseOrderDetail(html, orderId);
    if (!detail) {
      throw new ItsfoodError(`Detail order #${orderId} tidak terbaca`, 502);
    }
    return detail;
  });
}

/* ------------------------------------------------------------------ */
/* Accept order                                                        */
/* ------------------------------------------------------------------ */

export interface HasilTerima {
  sukses: boolean;
  pesan: string;
  statusBaru?: string;
}

/** Accept flow, mirroring the portal's own two steps:
    1. GET /orders/confirmOrder?order_id=X — the modal that carries
       supplier_id + csrf_token (also proves the order is still open)
    2. POST /orders/acceptOrder
    3. verify by re-reading the list: status must have left "Belum diproses"
    The portal silently no-ops on an already-processed order, so step 3 is
    what turns "request sent" into "actually accepted". */
export async function terimaOrder(orderId: string): Promise<HasilTerima> {
  return withSession(async (session) => {
    const modalRes = await fetch(
      `${BASE}/orders/confirmOrder?order_id=${encodeURIComponent(orderId)}`,
      {
        headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
        cache: "no-store",
      },
    );
    if (!modalRes.ok) {
      return { sukses: false, pesan: `Order #${orderId} tidak ditemukan` };
    }
    const modalHtml = await modalRes.text();
    const sid = modalHtml.match(/name="supplier_id"\s+value="(\d+)"/)?.[1];
    const csrf = modalHtml.match(/name="csrf_token"\s+value="([a-f0-9]+)"/)?.[1];
    if (!sid || !csrf) {
      return {
        sukses: false,
        pesan: `Order #${orderId} sudah tidak bisa diterima`,
      };
    }

    const body = new URLSearchParams({ order_id: orderId, supplier_id: sid, csrf_token: csrf });
    const post = await fetch(`${BASE}/orders/acceptOrder`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieHeader(session.jar),
        Referer: `${BASE}/orders`,
      },
      body: body.toString(),
      cache: "no-store",
    });
    if (!post.ok) {
      return { sukses: false, pesan: `acceptOrder gagal (HTTP ${post.status})` };
    }

    // Verify on a fresh list read.
    const params = new URLSearchParams({
      page: "1",
      "filters[delivery_date][start_date]": "",
      "filters[delivery_date][end_date]": "",
    });
    params.delete("filters[delivery_date][start_date]");
    params.delete("filters[delivery_date][end_date]");
    const html = await fetchOrdersPage(session, params);
    // Status order berubah → cache daftar order basi semua.
    cacheOrders.clear();
    const still = parseOrdersPage(html).find((o) => o.id === orderId);
    if (!still) return { sukses: true, pesan: `Order #${orderId} diterima` };
    if (still.status !== "Belum diproses") {
      return { sukses: true, pesan: `Order #${orderId} diterima`, statusBaru: still.status };
    }
    return {
      sukses: false,
      pesan: `Order #${orderId} masih "Belum diproses" — kemungkinan gagal`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Payments — billables / bills / history                              */
/* ------------------------------------------------------------------ */

/** Lifecycle pembayaran di portal:
      order selesai → billables ("Bisa Ditagih") → makeBill → bills
      (pending) → diproses & dibayar → history. */
async function scrapePaginated<T>(
  session: Session,
  path: string,
  parse: (html: string) => T[],
  maxPages: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${path}?page=${page}`, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
      cache: "no-store",
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) throw new ItsfoodError("SESSION_EXPIRED");
    if (!res.ok) throw new ItsfoodError(`HTTP ${res.status} dari ${path}`);
    const html = await res.text();
    if (html.length === 0 || html.includes("Login - Itsfood")) {
      throw new ItsfoodError("SESSION_EXPIRED");
    }
    const rows = parse(html);
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 10) break; // halaman terakhir
  }
  return out;
}

export interface DataPembayaran {
  billables: ItsfoodBillable[];
  bills: ItsfoodBill[];
  history: ItsfoodPaymentHistory[];
  peta: PetaBayarOrder;
  rekap: RekapPembayaran;
}

/** Ketiga halaman payments sekaligus — satu session, tiga scrape PARALEL
    (GET dengan cookie yang sama aman diparalel; halaman dalam satu daftar
    tetap berurutan karena butuh kondisi berhenti). History paling panjang,
    makanya cap-nya paling besar. */
export async function ambilPayments(): Promise<{
  data: DataPembayaran;
  stale: boolean;
  umurDetik: number;
}> {
  return denganCache(
    cachePayments,
    (e) => void (cachePayments = e),
    TTL_PAYMENTS,
    scrapePayments,
  );
}

async function scrapePayments(): Promise<DataPembayaran> {
  return withSession(async (session) => {
    const [billables, bills, history] = await Promise.all([
      scrapePaginated(session, `${BASE}/payments/billables`, parseBillablesPage, 10),
      scrapePaginated(session, `${BASE}/payments/bills`, parseBillsPage, 20),
      scrapePaginated(session, `${BASE}/payments/history`, parseHistoryPage, 30),
    ]);
    return {
      billables,
      bills,
      history,
      peta: petaBayarDari(billables, bills, history),
      rekap: rekapPembayaranDari(billables, bills, history),
    };
  });
}

/** Detail satu pembayaran — dipakai modal "Sudah Dibayar": isinya field
    identitas + tabel bills per order. Panggilan dari klik modal, tidak
    dicache (kecil dan jarang). */
export async function ambilDetailPayment(
  paymentId: string,
): Promise<ItsfoodPaymentDetail> {
  return withSession(async (session) => {
    const res = await fetch(`${BASE}/payments/payment/${encodeURIComponent(paymentId)}`, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
      cache: "no-store",
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) throw new ItsfoodError("SESSION_EXPIRED");
    if (!res.ok) {
      throw new ItsfoodError(`Pembayaran #${paymentId} tidak bisa dibuka (HTTP ${res.status})`, 404);
    }
    const html = await res.text();
    const detail = parsePaymentDetail(html, paymentId);
    if (!detail) throw new ItsfoodError(`Detail pembayaran #${paymentId} tidak terbaca`, 502);
    return detail;
  });
}

/** Buat tagihan dari satu order di billables — pola verifikasi sama
    dengan terimaOrder: scrape ulang, order harus hilang dari daftar. */
export async function buatTagihan(orderId: string): Promise<HasilTerima> {
  return withSession(async (session) => {
    const body = new URLSearchParams({ order_id: orderId, csrf_token: session.csrf });
    const post = await fetch(`${BASE}/payments/billables/makeBill`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieHeader(session.jar),
        Referer: `${BASE}/payments/billables`,
      },
      body: body.toString(),
      cache: "no-store",
    });
    if (!post.ok) {
      return { sukses: false, pesan: `makeBill gagal (HTTP ${post.status})` };
    }

    const masihAda = await scrapePaginated(
      session, `${BASE}/payments/billables`, parseBillablesPage, 10,
    );
    // Daftar billables berubah → cache payments basi.
    cachePayments = undefined;
    if (!masihAda.some((b) => b.orderId === orderId)) {
      return { sukses: true, pesan: `Tagihan order #${orderId} dibuat` };
    }
    return {
      sukses: false,
      pesan: `Order #${orderId} masih di daftar bisa ditagih — kemungkinan gagal`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* HTTP surface (shared by Vercel fn + Vite dev middleware)            */
/* ------------------------------------------------------------------ */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? "https://ddfalsclevkqhiyojngx.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP";

/** Prod guard: the caller must carry a live Supabase session JWT, exactly
    like the direct REST calls in the data layer. The dev middleware skips
    this (localhost only), mirroring VITE_E2E_AUTH_BYPASS. */
export async function guardItsfoodApi(req: Request): Promise<Response | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token === SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (r.ok) return null;
  } catch {
    /* jaringan/Supabase tak terjangkau — jatuh ke 401 di bawah */
  }
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------------ */
/* Adapter Node ↔ Web untuk Vercel functions                           */
/* ------------------------------------------------------------------ */

/** Runtime @vercel/node memakai (req, res) gaya Node; seluruh logika
    di atas berbicara Web Request/Response (dipakai bareng middleware
    dev). Konversi dua arah di sini — satu-satunya tempat tahu soal
    IncomingMessage. */
export async function nodeKeWebRequest(req: any): Promise<Request> {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v != null) headers.set(k, v as string);
  }
  const method = (req.method ?? "GET").toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (chunks.length) body = Buffer.concat(chunks).toString("utf8");
  }
  return new Request(url, {
    method,
    headers,
    body,
  });
}

export function balasNode(res: any, r: Response): Promise<void> {
  res.statusCode = r.status;
  const ct = r.headers.get("content-type");
  if (ct) res.setHeader("Content-Type", ct);
  return r.text().then((t) => res.end(t));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET handler — ?from=YYYY-MM-DD&to=YYYY-MM-DD[&detail=1] */
export async function handleItsfoodGet(url: URL): Promise<Response> {
  const orderId = url.searchParams.get("id");
  try {
    if (orderId) {
      return json({ ok: true, detail: await ambilDetailOrder(orderId) });
    }
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
      return json({ ok: false, error: "from & to wajib (YYYY-MM-DD)" }, 400);
    }
    const hasil = await ambilOrdersRentang({ from, to });
    return json({ ok: true, orders: hasil.data, stale: hasil.stale, umurDetik: hasil.umurDetik });
  } catch (e) {
    const err = e instanceof ItsfoodError ? e : null;
    return json(
      { ok: false, error: err?.message ?? "Gagal mengambil data itsfood" },
      err?.status ?? 502,
    );
  }
}

/** POST handler — { orderId } */
export async function handleItsfoodAccept(req: Request): Promise<Response> {
  const { orderId } = await req.json().catch(() => ({ orderId: "" }));
  if (!orderId || !/^\d+$/.test(String(orderId))) {
    return json({ ok: false, error: "orderId tidak valid" }, 400);
  }
  try {
    const hasil = await terimaOrder(String(orderId));
    return json(hasil, hasil.sukses ? 200 : 422);
  } catch (e) {
    const err = e instanceof ItsfoodError ? e : null;
    return json(
      { sukses: false, pesan: err?.message ?? "Gagal menerima order" },
      err?.status ?? 502,
    );
  }
}

/** GET /payments → data + rekap; GET /payments?id=N → detail satu
    pembayaran; POST /payments {orderId} → buat tagihan. `peta` (Set/Map)
    tidak ikut di-JSON — klien membangunnya lagi dari tiga daftar mentah
    via petaBayarDari(). */
export async function handleItsfoodPayments(req: Request): Promise<Response> {
  const url = new URL(req.url, "https://placeholder.local");
  const id = url.searchParams.get("id");
  if (req.method === "GET" && id) {
    try {
      return json({ ok: true, detail: await ambilDetailPayment(id) });
    } catch (e) {
      const err = e instanceof ItsfoodError ? e : null;
      return json(
        { ok: false, error: err?.message ?? "Gagal mengambil detail pembayaran" },
        err?.status ?? 502,
      );
    }
  }
  if (req.method === "POST") {
    const { orderId } = await req.json().catch(() => ({ orderId: "" }));
    if (!orderId || !/^\d+$/.test(String(orderId))) {
      return json({ ok: false, error: "orderId tidak valid" }, 400);
    }
    try {
      const hasil = await buatTagihan(String(orderId));
      return json(hasil, hasil.sukses ? 200 : 422);
    } catch (e) {
      const err = e instanceof ItsfoodError ? e : null;
      return json(
        { sukses: false, pesan: err?.message ?? "Gagal membuat tagihan" },
        err?.status ?? 502,
      );
    }
  }
  try {
    const { data, stale, umurDetik } = await ambilPayments();
    return json({
      ok: true,
      billables: data.billables,
      bills: data.bills,
      history: data.history,
      rekap: data.rekap,
      stale,
      umurDetik,
    });
  } catch (e) {
    const err = e instanceof ItsfoodError ? e : null;
    return json(
      { ok: false, error: err?.message ?? "Gagal mengambil data pembayaran" },
      err?.status ?? 502,
    );
  }
}
