// src/lib/itsfood.ts
function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function parseOrderRow(row) {
  const idMatch = row.match(/\/orders\/order\/(\d+)/);
  if (!idMatch) return null;
  const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? [];
  const text = cells.map(stripTags);
  const pill = row.match(/pill[^>]*>\s*([^<]+?)\s*</);
  const status = pill ? pill[1].trim() : text[6] || "";
  const delivery = splitDate((text[3] ?? "").replace(/^Delivery Date:\s*/, ""));
  const ordered = splitDate((text[2] ?? "").replace(/^Order Date:\s*/, ""));
  return {
    id: idMatch[1],
    customer: (text[1] ?? "").replace(/^Customer:\s*/, ""),
    orderedDate: ordered.date,
    orderedTime: ordered.time,
    deliveryDate: delivery.date,
    deliveryTime: delivery.time,
    purpose: (text[4] ?? "").replace(/^Keperluan:\s*/, ""),
    address: (text[5] ?? "").replace(/^Alamat:\s*/, ""),
    status,
    canAccept: row.includes("confirmOrder")
  };
}
function splitDate(value) {
  const parts = value.trim().split(/\s+/);
  return { date: parts[0] ?? "", time: parts.slice(1).join(" ") };
}
function parseOrdersPage(html) {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];
  const rows = tbody[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const out = [];
  for (const row of rows) {
    const order = parseOrderRow(row);
    if (order) out.push(order);
  }
  return out;
}
function parseOrderDetail(html, id) {
  const sections = html.match(/<section[^>]*>([\s\S]*?)<\/section>/g);
  if (!sections || sections.length === 0) return null;
  const fields = parseLabeledFields(sections[0]);
  const items = sections[1] ? parseItemsSection(sections[1]) : [];
  return {
    id,
    pemesan: fields["Pemesan"] ?? "",
    unit: fields["Unit"] ?? "",
    telepon: fields["No Telp"] ?? "",
    email: fields["Email"] ?? "",
    alamat: fields["Alamat Pengiriman"] ?? "",
    waktuPemesanan: fields["Waktu Pemesanan"] ?? "",
    waktuPengantaran: fields["Waktu Pengantaran"] ?? "",
    tujuan: fields["Tujuan Pemesanan"] ?? "",
    catatan: fields["Catatan"] ?? "",
    items
  };
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
function parseItemsSection(section) {
  const rows = section.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const items = [];
  for (const row of rows) {
    if (!row.includes("Menu:")) continue;
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
    const cell = (i) => stripTags((tds[i] ?? "").replace(/<div class="lg:hidden[^>]*>[^<]*<\/div>/, ""));
    items.push({
      name: cell(0),
      price: cell(1),
      qty: cell(3),
      // Subtotal cell = "Price: X COGS: Y" → ambil amount pertama.
      subtotal: (cell(4).match(/Rp\.?\s*[\d.,]+/) ?? [cell(4)])[0]
    });
  }
  return items;
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
async function fetchOrdersPage(session, params) {
  const res = await fetch(`${BASE}/orders?${params.toString()}`, {
    headers: {
      "User-Agent": UA,
      Cookie: cookieHeader(session.jar)
    },
    cache: "no-store",
    redirect: "manual"
  });
  if (res.status >= 300 && res.status < 400) throw new ItsfoodError("SESSION_EXPIRED");
  if (!res.ok) throw new ItsfoodError(`HTTP ${res.status} dari /orders`);
  const html = await res.text();
  if (html.length === 0 || html.includes("Login - Itsfood")) {
    throw new ItsfoodError("SESSION_EXPIRED");
  }
  return html;
}
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
var cacheOrders = /* @__PURE__ */ new Map();
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
async function ambilOrdersRentang({ from, to, maxPages = 20 }) {
  const kunci = `${from}|${to}`;
  return denganCache(
    cacheOrders.get(kunci),
    (e) => void cacheOrders.set(kunci, e),
    TTL_ORDERS,
    () => scrapeOrdersRentang({ from, to, maxPages })
  );
}
async function scrapeOrdersRentang({ from, to, maxPages = 20 }) {
  return withSession(async (session) => {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        page: String(page),
        "filters[delivery_date][start_date]": from,
        "filters[delivery_date][end_date]": to
      });
      const html = await fetchOrdersPage(session, params);
      const orders = parseOrdersPage(html);
      if (orders.length === 0) break;
      out.push(...orders);
      if (orders.length < 10) break;
    }
    return out;
  });
}
async function ambilDetailOrder(orderId) {
  return withSession(async (session) => {
    const res = await fetch(`${BASE}/orders/order/${orderId}`, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
      cache: "no-store",
      redirect: "manual"
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
async function handleItsfoodGet(url) {
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
      err?.status ?? 502
    );
  }
}

// src/server/api/orders.ts
async function handler(req, res) {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void await balasNode(res, denied);
    await balasNode(res, await handleItsfoodGet(new URL(web.url)));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
export {
  handler as default
};
