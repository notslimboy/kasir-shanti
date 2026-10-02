import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
});
