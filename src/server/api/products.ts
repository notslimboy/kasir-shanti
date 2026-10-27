/* Vercel function — /api/itsfood/products
   GET         → daftar produk dari portal supplier
   GET ?id=N   → detail satu produk
   Guard JWT Supabase sama dengan endpoint itsfood lain. */

import {
  balasNode,
  guardItsfoodApi,
  handleItsfoodProducts,
  nodeKeWebRequest,
} from "../itsfood-server.js";

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void (await balasNode(res, denied));
    await balasNode(res, await handleItsfoodProducts(web));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}