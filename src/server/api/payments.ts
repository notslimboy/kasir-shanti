/* Vercel function — /api/itsfood/payments
   GET            → billables + bills + history + rekap omzet
   GET ?id=N      → detail satu pembayaran (per-order bills)
   POST {orderId} → buat tagihan (makeBill) dari daftar bisa-ditagih
   Guard JWT Supabase sama dengan endpoint itsfood lain. */

import {
  balasNode,
  guardItsfoodApi,
  handleItsfoodPayments,
  nodeKeWebRequest,
} from "../itsfood-server.js";

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void (await balasNode(res, denied));
    await balasNode(res, await handleItsfoodPayments(web));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
