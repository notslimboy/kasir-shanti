/* Vercel function — GET /api/itsfood/orders
   ?id=ORDER_ID        → satu detail order
   ?from=ISO&to=ISO    → semua order delivery dalam rentang

   Signature (req, res) gaya Node — itu yang didukung runtime
   @vercel/node; Web-style Response membuat function menggantung. */

import {
  balasNode,
  guardItsfoodApi,
  handleItsfoodGet,
  nodeKeWebRequest,
} from "../../src/server/itsfood-server";

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const web = await nodeKeWebRequest(req);
    const denied = await guardItsfoodApi(web);
    if (denied) return void (await balasNode(res, denied));
    await balasNode(res, await handleItsfoodGet(new URL(web.url)));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
