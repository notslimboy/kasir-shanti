/* Vercel function — /api/itsfood/payments
   GET            → billables + bills + history + rekap omzet
   POST {orderId} → buat tagihan (makeBill) dari daftar bisa-ditagih
   Guard JWT Supabase sama dengan endpoint itsfood lain. */

import { guardItsfoodApi, handleItsfoodPayments } from "../src/server/itsfood-server";

export default async function handler(req: Request): Promise<Response> {
  const denied = await guardItsfoodApi(req);
  if (denied) return denied;
  return handleItsfoodPayments(req);
}
