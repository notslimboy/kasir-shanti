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
function parseProductsPage(html) {
  return rowsFromTbody(html).map((cells) => {
    const id = (cells[0] ?? "").match(/(\d+)/)?.[1] ?? "";
    if (!id) return null;
    return {
      id,
      name: (cells[1] ?? "").replace(/^(Nama|Name):\s*/i, "").trim(),
      category: (cells[2] ?? "").replace(/^(Kategori|Category):\s*/i, "").trim(),
      price: (cells[3] ?? "").replace(/^(Harga|Price):\s*/i, "").trim(),
      cogs: (cells[4] ?? "").replace(/^(COGS|HPP):\s*/i, "").trim(),
      status: (cells[5] ?? "").replace(/^(Status):\s*/i, "").trim(),
      createdAt: (cells[6] ?? "").replace(/^(Created At|Dibuat):\s*/i, "").trim()
    };
  }).filter((x) => x !== null);
}
function parseProductDetail(html, id) {
  const sections = html.match(/<section[^>]*>([\s\S]*?)<\/section>/g);
  if (!sections || sections.length === 0) return null;
  const fields = parseLabeledFields(sections[0]);
  return {
    id,
    name: fields["Nama"] ?? "",
    supplier: fields["Supplier"] ?? "",
    category: fields["Kategori"] ?? "",
    status: fields["Status"] ?? "",
    description: fields["Description"] ?? "",
    createdAt: fields["Created at"] ?? "",
    price: fields["Harga"] ?? "",
    cogs: fields["COGS"] ?? "",
    minOrder: fields["Min Order"] ?? "",
    maxOrder: fields["Max Order"] ?? "",
    preOrderDays: fields["Pre Order Days"] ?? "",
    preOrderHours: fields["Pre Order Hours"] ?? "",
    tags: fields["Tags"] ?? ""
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
var cacheProducts;
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
var MAX_PAGES_PRODUCTS = 50;
async function scrapeProducts() {
  return withSession(async (session) => {
    const products = await scrapePaginated(
      session,
      `${BASE}/products`,
      parseProductsPage,
      MAX_PAGES_PRODUCTS
    );
    return { products };
  });
}
async function ambilProduk() {
  return denganCache(
    cacheProducts,
    (e) => void (cacheProducts = e),
    TTL_PAYMENTS,
    scrapeProducts
  );
}
async function ambilDetailProduk(productId) {
  return withSession(async (session) => {
    const res = await fetch(
      `${BASE}/products/product/${encodeURIComponent(productId)}`,
      {
        headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) },
        cache: "no-store",
        redirect: "manual"
      }
    );
    if (res.status >= 300 && res.status < 400) {
      throw new ItsfoodError("SESSION_EXPIRED");
    }
    if (!res.ok) {
      throw new ItsfoodError(
        `Produk #${productId} tidak bisa dibuka (HTTP ${res.status})`,
        404
      );
    }
    const html = await res.text();
    if (html.length === 0 || html.includes("Login - Itsfood")) {
      throw new ItsfoodError("SESSION_EXPIRED");
    }
    const detail = parseProductDetail(html, productId);
    if (!detail) {
      throw new ItsfoodError(`Detail produk #${productId} tidak terbaca`, 502);
    }
    return detail;
  });
}
async function handleItsfoodProducts(req) {
  const url = new URL(req.url, "https://placeholder.local");
  const id = url.searchParams.get("id");
  if (id) {
    try {
      return json({ ok: true, detail: await ambilDetailProduk(id) });
    } catch (e) {
      const err = e instanceof ItsfoodError ? e : null;
      return json(
        { ok: false, error: err?.message ?? "Gagal mengambil detail produk" },
        err?.status ?? 502
      );
    }
  }
  try {
    const { data, stale, umurDetik } = await ambilProduk();
    return json({
      ok: true,
      products: data.products,
      stale,
      umurDetik
    });
  } catch (e) {
    const err = e instanceof ItsfoodError ? e : null;
    return json(
      { ok: false, error: err?.message ?? "Gagal mengambil daftar produk" },
      err?.status ?? 502
    );
  }
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

// src/server/api/products.ts
async function handler(req, res) {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void await balasNode(res, denied);
    await balasNode(res, await handleItsfoodProducts(web));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
export {
  handler as default
};
