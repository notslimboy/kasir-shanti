import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/* ==========================================================================
   Itsfood dev API — middleware pengganti Vercel Functions saat `npm run dev`.

   Di production, /api/itsfood/* dijawab serverless function di api/.
   Browser tidak bisa memanggil supplier.itsfood.id langsung (CORS), jadi
   dev server perlu menawarkan endpoint same-origin yang sama. Middleware
   ini menjalankan kode server yang PERSIS sama (src/server/itsfood-server),
   tanpa guard JWT — localhost saja, selaras dengan VITE_E2E_AUTH_BYPASS.
   ========================================================================== */

/* Impor statis: vite.config dibundel esbuild saat dimuat, jadi modul server
   ikut ter-transform di sini — tidak menyentuh bundle client (vite.config
   memang bukan bagian dari app). Impor dinamis justru gagal karena Node
   menuntut ekstensi file untuk ESM. */
import {
  handleItsfoodAccept,
  handleItsfoodGet,
  handleItsfoodPayments,
} from "./src/server/itsfood-server";

function itsfoodMiddleware(): Plugin {
  return {
    name: "itsfood-dev-api",
    configureServer(dev) {
      dev.middlewares.use("/api/itsfood", (req: Connect.IncomingMessage, res) => {
        void (async () => {
          try {
            // "/orders?from=..." atau "/accept" (prefix sudah dilepas connect)
            const url = new URL(req.url ?? "/", "http://localhost");
            const method = (req.method ?? "GET").toUpperCase();

            let body: string | undefined;
            if (method === "POST") {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(chunk as Buffer);
              body = Buffer.concat(chunks).toString("utf8");
            }

            const request = new Request(`http://localhost${req.url}`, {
              method,
              headers: { "Content-Type": "application/json" },
              body,
            });

            const response =
              url.pathname === "/accept" && method === "POST"
                ? await handleItsfoodAccept(request)
                : url.pathname === "/payments"
                  ? await handleItsfoodPayments(request)
                  : await handleItsfoodGet(url);

            res.statusCode = response.status;
            res.setHeader("Content-Type", "application/json");
            res.end(await response.text());
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        })();
      });
    },
  };
}

export default defineConfig(async ({ mode }) => {
  /* Prefix "" = muat SEMUA variabel (bukan cuma VITE_*), lalu isikan ke
     process.env supaya itsfood-server bisa membaca ITSFOOD_*. Variabel
     yang sudah ada di lingkungan tidak ditimpa. */
  const env = loadEnv(mode, path.resolve(__dirname), "");
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  /* Modul server diimpor statis di atas; di sini cukup dipasang. */
  return {
    plugins: [react(), tailwindcss(), itsfoodMiddleware()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    test: {
      /* `e2e/` milik Playwright, bukan vitest. Tanpa exclude di sini,
         `npm test` ikut memuat file-file itu dan gagal dengan pesan
         "Playwright Test did not expect test.describe() to be called
         here" — bukan karena ada bug, cuma karena dua runner berebut file
         yang sama.

         File `.test.js` ikut dikecualikan karena `tsc -b` pernah meng-emit
         JS ke dalam src/ (lihat script `typecheck` di package.json). File
         `.js` itu hasil stale, bukan source, dan memuatnya membuat setiap
         test jalan dua kali dengan angka yang terlihat meyakinkan. */
      exclude: ["e2e/**", "node_modules/**", "dist/**", "src/**/*.test.js"],
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
