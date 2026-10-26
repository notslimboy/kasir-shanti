/* Vercel function — POST /api/itsfood/accept  { orderId }
   Menerima satu order di portal supplier. Guard JWT sama dengan endpoint
   GET: tanpa sesi Supabase yang sah, tombol Terima tidak bisa ditembak. */

import { guardItsfoodApi, handleItsfoodAccept } from "../src/server/itsfood-server";

export default async function handler(req: Request): Promise<Response> {
  const denied = await guardItsfoodApi(req);
  if (denied) return denied;
  return handleItsfoodAccept(req);
}
