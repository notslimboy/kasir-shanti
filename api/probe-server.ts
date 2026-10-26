/* Probe #2 — hanya MENGIMPORT modul server (tanpa menjalankan logika).
   Kalau ini 500: module init-nya yang meledak di runtime Vercel.
   Kalau ini 200: init aman, masalahnya di dalam handler. */
import { handleItsfoodGet } from "../src/server/itsfood-server";

export default function handler(_req: any, res: any): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      imported: typeof handleItsfoodGet,
    }),
  );
}
