import { defineConfig, devices } from "@playwright/test";

/* E2E diarahkan ke `vite preview`, bukan `vite dev`.
   Dev server punya SPA fallback dan HMR; yang tidak ada di produksi.
   Vercel menyajikan hasil `vite build` sebagai file statis, jadi hanya
   `preview` yang mereproduksi kondisi itu. Kalau sebuah route lolos di dev
   tapi 404 di preview, itu justru bug yang mau ketahuan. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  /* `localhost`, bukan `127.0.0.1`. `vite preview` bind ke IPv6 `[::1]`
     saja di beberapa versi —mengakses 127.0.0.1 berakhir connection refused
     walau layanannya sehat, dan webServer timeout padahal bukan salah
     aplikasinya. */
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },

  projects: [
    {
      name: "desktop",
      /* `testIgnore` wajib, bukan cuma `testMatch` di project mobile.
         `testMatch` cuma membatasi project yang diisi; tanpa `testIgnore`
         di sini, file mobile ikut jalan di desktop dan gagal semua —
         karena ia memang behaviouralmobile. */
      testIgnore: /miring\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      /* `/impor` desktop-only (App.tsx DesktopOnly). Kalau proyek ini
         gagal, itu bug redirect — bukan test yang salah. */
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /miring\.spec\.ts/,
    },
  ],

  webServer: {
    /* `VITE_E2E_AUTH_BYPASS=1` lets the built app skip the sign-in screen,
       which is what the auth module checks together with a localhost
       hostname. Both halves are required: set the flag on a real deployment
       and it does nothing, because the hostname is not localhost. See
       `bolehLewatiAuth` in src/lib/auth.tsx.

       Runs without live data, deliberately. With RLS closed the publishable
       key can no longer read anything, so the suite exercises the empty-state
       behaviour — which is what these specs already assert.

       `vite preview`, not `vercel dev`: the rewrite rules in `vercel.json` are
       asserted in `vercel-rewrite.test.ts` instead. Running the real Vercel
       dev server per `npm run e2e` would add a network dependency and ~40s
       of startup to every run, and it executes the dev server rather than
       the built output. The env flag travels via the `env` field, not a
       `VITE_..=1 cmd` shell prefix: that prefix only parses in POSIX
       shells; this webServer runs in cmd.exe on Windows and would
       exit 1 outright. */
    command: "npm run build && npx vite preview --port 4173 --strictPort --host localhost",
    env: { VITE_E2E_AUTH_BYPASS: "1" },
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});