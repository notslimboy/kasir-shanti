// src/lib/itsfood.ts
function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function parseLabeledFields(section) {
  const out = {};
  const pairs = section.matchAll(
    /<h[45][^>]*>\s*([^<]+?)\s*<\/h[45]>\s*<span[^>]*>([\s\S]*?)<\/span>/g
  );
  for (const pair of pairs) {
    const label = stripTags(pair[1]).replace(/:\s*$/, "");
    if (label) out[label] = stripTags(pair[2]);
  }
  return out;
}
function parseRupiah(raw) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}
function rowsFromTbody(html) {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];
  const rows = tbody[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const out = [];
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? [];
    out.push(
      cells.map(
        (c) => stripTags(
          c.replace(/<(div|span)\b[^>]*\blg:hidden\b[^>]*>[\s\S]*?<\/\1>/g, "").replace(/<div class="lg:hidden[^>]*>[^<]*<\/div>/g, "")
        )
      )
    );
  }
  return out;
}
function parseBillablesPage(html) {
  return rowsFromTbody(html).map((cells) => {
    const orderId = cells[0]?.match(/(?:Order Id:\s*)?(\d{5,})/)?.[1];
    if (!orderId) return null;
    const amount = cells[4] ?? "";
    return {
      orderId,
      customer: (cells[1] ?? "").replace(/^Customer:\s*/, ""),
      deliveryDate: (cells[2] ?? "").replace(/^Delivery Date:\s*/, ""),
      purpose: (cells[3] ?? "").replace(/^Order Purpose:\s*/, ""),
      amount,
      amountValue: parseRupiah(amount)
    };
  }).filter((x) => x !== null);
}
function parseBillsPage(html) {
  return rowsFromTbody(html).map((cells) => {
    const billId = (cells[0] ?? "").replace(/^Bill ID:\s*/, "");
    if (!/^\d+$/.test(billId)) return null;
    const receivable = cells[5] ?? "";
    return {
      billId,
      orderId: (cells[1] ?? "").replace(/^Order ID:\s*/, ""),
      createdAt: (cells[2] ?? "").replace(/^Created At:\s*/, ""),
      processDate: (cells[3] ?? "").replace(/^Process Date:\s*/, ""),
      paidDate: (cells[4] ?? "").replace(/^Paid Date:\s*/, ""),
      receivable,
      receivableValue: parseRupiah(receivable),
      status: (cells[6] ?? "").replace(/^Status:\s*/, "")
    };
  }).filter((x) => x !== null);
}
function parseHistoryPage(html) {
  return rowsFromTbody(html).map((cells) => {
    const id = (cells[0] ?? "").replace(/^Id:\s*/, "");
    if (!/^\d+$/.test(id)) return null;
    const total = cells[3] ?? "";
    const ids = (cells[6] ?? "").replace(/^Order Ids?:?\s*/, "");
    return {
      id,
      processDate: (cells[1] ?? "").replace(/^Process Date:\s*/, ""),
      paidDate: (cells[2] ?? "").replace(/^Paid Date:\s*/, ""),
      total,
      totalValue: parseRupiah(total),
      bank: (cells[4] ?? "").replace(/^Bank:\s*/, ""),
      orderIds: ids.split(",").map((s) => s.trim()).filter(Boolean)
    };
  }).filter((x) => x !== null);
}
function terbayarDari(history) {
  return new Set(history.flatMap((h) => h.orderIds));
}
function petaBayarDari(billables, bills, history) {
  return {
    bisaDitagih: new Set(billables.map((b) => b.orderId)),
    tagihanPending: new Map(bills.map((b) => [b.orderId, b])),
    terbayar: terbayarDari(history)
  };
}
function rekapPembayaranDari(billables, bills, history) {
  const bisaDitagih = billables.reduce((a, b) => a + b.amountValue, 0);
  const terbayar = terbayarDari(history);
  const belumTerbayar = bills.filter((b) => !/cancel|reject/i.test(b.status) && !terbayar.has(b.orderId)).reduce((a, b) => a + b.receivableValue, 0);
  const sudahDibayar = history.reduce((a, h) => a + h.totalValue, 0);
  return {
    omzet: bisaDitagih + belumTerbayar + sudahDibayar,
    bisaDitagih,
    belumTerbayar,
    sudahDibayar
  };
}
function parsePaymentDetail(html, id) {
  const sections = html.match(/<section[^>]*>([\s\S]*?)<\/section>/g);
  if (!sections || sections.length === 0) return null;
  const fields = parseLabeledFields(sections[0]);
  const bills = rowsFromTbody(html).map((c) => {
    const billId = (c[0] ?? "").replace(/^Bill Id:\s*/i, "");
    if (!/^\d+$/.test(billId)) return null;
    const payable = c[3] ?? "";
    return {
      billId,
      orderId: (c[1] ?? "").replace(/^Order Id:\s*/i, ""),
      deliveryDate: (c[2] ?? "").replace(/^Delivery Date:\s*/i, ""),
      payable,
      payableValue: parseRupiah(payable),
      billedAt: (c[4] ?? "").replace(/^Billed At:\s*/i, "")
    };
  }).filter((x) => x !== null);
  const total = fields["Total Amount"] ?? "";
  return {
    id,
    processDate: fields["Process Date"] ?? "",
    createdAt: fields["Created At"] ?? "",
    total,
    totalValue: parseRupiah(total),
    paidDate: fields["Paid Date"] ?? "",
    bank: fields["Bank"] ?? "",
    bills
  };
}

// src/server/itsfood-server.ts
var BASE = "https://supplier.itsfood.id";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
function readSetCookies(res) {
  const jar = {};
  const list = res.headers.getSetCookie?.() ?? [];
  for (const sc of list) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}
function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
var SESI_MAKSU = 100 * 6e4;
var sesiCache = null;
async function loginItsfood() {
  const username = process.env.ITSFOOD_USERNAME;
  const password = process.env.ITSFOOD_PASSWORD;
  if (!username || !password) {
    throw new ItsfoodError(
      "ITSFOOD_USERNAME / ITSFOOD_PASSWORD belum diisi di environment",
      500
    );
  }
  const r1 = await fetch(`${BASE}/login`, {
    headers: { "User-Agent": UA },
    cache: "no-store"
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
      Referer: `${BASE}/login`
    },
    body: body.toString(),
    cache: "no-store"
  });
  let json2 = null;
  try {
    json2 = await r2.json();
  } catch {
  }
  if (!json2 || json2.status !== "success") {
    throw new ItsfoodError(
      json2?.description || json2?.message || `Login itsfood gagal (HTTP ${r2.status})`,
      502
    );
  }
  const jar = { ...jar1, ...readSetCookies(r2) };
  const session = { jar, csrf };
  sesiCache = { session, at: Date.now() };
  return session;
}
var ItsfoodError = class extends Error {
  status;
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
};
async function withSession(fn) {
  if (sesiCache && Date.now() - sesiCache.at < SESI_MAKSU) {
    try {
      return await fn(sesiCache.session);
    } catch (e) {
      if (!(e instanceof ItsfoodError && e.message === "SESSION_EXPIRED")) throw e;
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
var TTL_ORDERS = 3 * 6e4;
var TTL_PAYMENTS = 5 * 6e4;
var cachePayments;
async function denganCache(entri, simpan, ttl, fetcher) {
  if (entri) {
    const umur = Date.now() - entri.at;
    if (umur < ttl) {
      return { data: entri.data, stale: false, umurDetik: Math.round(umur / 1e3) };
    }
    if (!entri.segarkan) {
      entri.segarkan = fetcher().then((data2) => simpan({ data: data2, at: Date.now() })).catch(() => {
      }).finally(() => {
        entri.segarkan = void 0;
      });
    }
    return {
      data: entri.data,
      stale: true,
      umurDetik: Math.round(umur / 1e3)
    };
  }
  const data = await fetcher();
  const e = { data, at: Date.now() };
  simpan(e);
  return { data, stale: false, umurDetik: 0 };
}
async function scrapePaginated(session, path, parse, maxPages) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${path}?page=${page}`, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
      cache: "no-store",
      redirect: "manual"
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
    if (rows.length < 10) break;
  }
  return out;
}
var MAX_PAGES_BILLABLES = 20;
var MAX_PAGES_BILLS = 100;
var MAX_PAGES_HISTORY = 150;
async function ambilPayments() {
  return denganCache(
    cachePayments,
    (e) => void (cachePayments = e),
    TTL_PAYMENTS,
    scrapePayments
  );
}
async function scrapePayments() {
  return withSession(async (session) => {
    const [billables, bills, history] = await Promise.all([
      scrapePaginated(session, `${BASE}/payments/billables`, parseBillablesPage, MAX_PAGES_BILLABLES),
      scrapePaginated(session, `${BASE}/payments/bills`, parseBillsPage, MAX_PAGES_BILLS),
      scrapePaginated(session, `${BASE}/payments/history`, parseHistoryPage, MAX_PAGES_HISTORY)
    ]);
    return {
      billables,
      bills,
      history,
      peta: petaBayarDari(billables, bills, history),
      rekap: rekapPembayaranDari(billables, bills, history)
    };
  });
}
async function ambilDetailPayment(paymentId) {
  return withSession(async (session) => {
    const res = await fetch(`${BASE}/payments/payment/${encodeURIComponent(paymentId)}`, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
      cache: "no-store",
      redirect: "manual"
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
async function buatTagihan(orderId) {
  return withSession(async (session) => {
    const body = new URLSearchParams({ order_id: orderId, csrf_token: session.csrf });
    const post = await fetch(`${BASE}/payments/billables/makeBill`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieHeader(session.jar),
        Referer: `${BASE}/payments/billables`
      },
      body: body.toString(),
      cache: "no-store"
    });
    if (!post.ok) {
      return { sukses: false, pesan: `makeBill gagal (HTTP ${post.status})` };
    }
    const masihAda = await scrapePaginated(
      session,
      `${BASE}/payments/billables`,
      parseBillablesPage,
      10
    );
    cachePayments = void 0;
    if (!masihAda.some((b) => b.orderId === orderId)) {
      return { sukses: true, pesan: `Tagihan order #${orderId} dibuat` };
    }
    return {
      sukses: false,
      pesan: `Order #${orderId} masih di daftar bisa ditagih \u2014 kemungkinan gagal`
    };
  });
}
var SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "https://ddfalsclevkqhiyojngx.supabase.co";
var SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP";
async function guardItsfoodApi(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token === SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (r.ok) return null;
  } catch {
  }
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
async function nodeKeWebRequest(req) {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v != null) headers.set(k, v);
  }
  const method = (req.method ?? "GET").toUpperCase();
  let body;
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length) body = Buffer.concat(chunks).toString("utf8");
  }
  return new Request(url, {
    method,
    headers,
    body
  });
}
function balasNode(res, r) {
  res.statusCode = r.status;
  const ct = r.headers.get("content-type");
  if (ct) res.setHeader("Content-Type", ct);
  return r.text().then((t) => res.end(t));
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
async function handleItsfoodPayments(req) {
  const url = new URL(req.url, "https://placeholder.local");
  const id = url.searchParams.get("id");
  if (req.method === "GET" && id) {
    try {
      return json({ ok: true, detail: await ambilDetailPayment(id) });
    } catch (e) {
      const err = e instanceof ItsfoodError ? e : null;
      return json(
        { ok: false, error: err?.message ?? "Gagal mengambil detail pembayaran" },
        err?.status ?? 502
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
        err?.status ?? 502
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
      umurDetik
    });
  } catch (e) {
    const err = e instanceof ItsfoodError ? e : null;
    return json(
      { ok: false, error: err?.message ?? "Gagal mengambil data pembayaran" },
      err?.status ?? 502
    );
  }
}

// src/server/api/payments.ts
async function handler(req, res) {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void await balasNode(res, denied);
    await balasNode(res, await handleItsfoodPayments(web));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
export {
  handler as default
};
