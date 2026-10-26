/* Vercel function — GET /api/itsfood/orders
   ?id=ORDER_ID        → satu detail order
   ?from=ISO&to=ISO    → semua order delivery dalam rentang

   Verifikasi JWT Supabase memakai guard yang sama dengan aturan repo:
   publishable key boleh publik, tapi akses data butuh sesi sign-in. */

import { guardItsfoodApi, handleItsfoodGet } from "../src/server/itsfood-server";

export default async function handler(req: Request): Promise<Response> {
  const denied = await guardItsfoodApi(req);
  if (denied) return denied;
  return handleItsfoodGet(new URL(req.url, "https://placeholder.local"));
}

export const config = { runtime: "nodejs" };
