/* Vercel function — POST /api/itsfood/accept  { orderId }
   Menerima satu order di portal supplier. Guard JWT sama dengan endpoint
   GET: tanpa sesi Supabase yang sah, tombol Terima tidak bisa ditembak. */

import {
  balasNode,
  guardItsfoodApi,
  handleItsfoodAccept,
  nodeKeWebRequest,
} from "../../src/server/itsfood-server";

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void (await balasNode(res, denied));
    await balasNode(res, await handleItsfoodAccept(web));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
