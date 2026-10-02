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
       yang sama. */
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
