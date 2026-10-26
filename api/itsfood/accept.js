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
async function terimaOrder(orderId) {
  return withSession(async (session) => {
    const modalRes = await fetch(
      `${BASE}/orders/confirmOrder?order_id=${encodeURIComponent(orderId)}`,
      {
        headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
        cache: "no-store"
      }
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
        pesan: `Order #${orderId} sudah tidak bisa diterima`
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
        Referer: `${BASE}/orders`
      },
      body: body.toString(),
      cache: "no-store"
    });
    if (!post.ok) {
      return { sukses: false, pesan: `acceptOrder gagal (HTTP ${post.status})` };
    }
    const params = new URLSearchParams({
      page: "1",
      "filters[delivery_date][start_date]": "",
      "filters[delivery_date][end_date]": ""
    });
    params.delete("filters[delivery_date][start_date]");
    params.delete("filters[delivery_date][end_date]");
    const html = await fetchOrdersPage(session, params);
    cacheOrders.clear();
    const still = parseOrdersPage(html).find((o) => o.id === orderId);
    if (!still) return { sukses: true, pesan: `Order #${orderId} diterima` };
    if (still.status !== "Belum diproses") {
      return { sukses: true, pesan: `Order #${orderId} diterima`, statusBaru: still.status };
    }
    return {
      sukses: false,
      pesan: `Order #${orderId} masih "Belum diproses" \u2014 kemungkinan gagal`
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
async function handleItsfoodAccept(req) {
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
      err?.status ?? 502
    );
  }
}

// src/server/api/accept.ts
async function handler(req, res) {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void await balasNode(res, denied);
    await balasNode(res, await handleItsfoodAccept(web));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
export {
  handler as default
};
