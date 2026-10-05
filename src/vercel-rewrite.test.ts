import { describe, expect, it } from "vitest";

import vercel from "../vercel.json";

/* Rewrite rules in `vercel.json`.
 *
 * The SPA rewrite is what makes `/kasir` survive a hard refresh instead of
 * 404ing. Its cost is that it also swallows every missing asset: a thermal
 * logo that was never committed came back as `200 text/html`, the `<img>`
 * failed to decode, and the receipt printed a broken-image icon with the alt
 * text. A `200` in the network tab is exactly what made that look healthy.
 *
 * So the rewrite has to be narrow. Asserted on the parsed config rather than
 * against a running server: `vercel dev` executes the dev server instead of
 * the build output, and standing one up per `npm run e2e` would cost a
 * network dependency and ~40s for behaviour that is pure string matching. */

type Rewrite = { source: string; destination: string };

const rewrites = vercel.rewrites as Rewrite[];

/** Would a request for `path` hit the SPA rewrite? */
function ditulisUlang(path: string): boolean {
  const source = rewrites[0]?.source ?? "";
  /* Translate this config's single pattern into a plain test. Parsing the
     negative lookahead properly is more machinery than the rule deserves, so
     the alternatives are read out of the source and matched as prefixes. */
  /* `(?!…)` is followed by `.*`, not by a slash, so the group ends at the
     lookahead's own closing paren. */
  const excluded = source.match(/\(\?!([\s\S]*?)\)/)?.[1] ?? "";
  /* Each alternative is either a directory (`assets/`, `thermal/`) or a file
     (`favicon\.png`). Requests start with a slash, so a directory has to get
     the leading slash back: without it, `"/assets/x.js".startsWith("assets")`
     is false and the test would quietly pass the wrong way round. */
  const prefixes = excluded
    .split("|")
    .filter(Boolean)
    .map((p) => "/" + p.replace(/^\/+|\/+$/g, "").replace(/\\\./g, "."));
  return !prefixes.some((p) => path.startsWith(p));
}

describe("vercel.json rewrite", () => {
  it("hanya ada satu aturan rewrite", () => {
    /* More than one rule here means one of them is unreachable, since the
       first match wins and `rewrites[0]` is what everything else assumes. */
    expect(rewrites).toHaveLength(1);
  });

  it("mengarahkan ke index.html supaya hard refresh tidak 404", () => {
    expect(rewrites[0].destination).toBe("/index.html");
  });

  it("tidak menelan aset di /assets", () => {
    /* `/assets/` is Vite's build output — hashed bundles, CSS, fonts. A
       rewrite over it turns every stale or mistyped bundle URL into an HTML
       body, which surfaces as "Unexpected token '<'" with nothing pointing
       at the real cause. */
    for (const p of ["/assets/index-abc123.js", "/assets/index-def456.css", "/assets/logo.png"]) {
      expect(ditulisUlang(p), `${p} seharusnya dilayani apa adanya`).toBe(false);
    }
  });

  it("tidak menelan aset di /thermal", () => {
    /* The logo that was missing. Excluding the directory is what turns a
       silently broken receipt into an honest 404 in the network tab. */
    expect(ditulisUlang("/thermal/logo-thermal-256-threshold.png")).toBe(false);
    expect(ditulisUlang("/thermal/logo-thermal-320-threshold.png")).toBe(false);
    expect(ditulisUlang("/thermal/tidak-ada.png")).toBe(false);
  });

  it("tidak menelan favicon", () => {
    /* Not what broke the receipt, but the same class of bug: the browser
       asks for it unprompted, so a rewritten favicon means the tab shows a
       blank page icon with no way to tell why. */
    expect(ditulisUlang("/favicon.png")).toBe(false);
  });

  it("tetap menulis ulang route dalam aplikasi", () => {
    for (const p of ["/", "/kasir", "/menu", "/penjualan", "/piutang", "/customer", "/pengaturan", "/impor"]) {
      expect(ditulisUlang(p), `${p} harus ditulis ulang ke index.html`).toBe(true);
    }
  });

  it("build dan output tetap Vite, bukan Next.js", () => {
    /* The project was configured with the Next.js preset, and the build
       failed outright with "No Next.js version detected". Pinning it here
       means a preset left over in the dashboard cannot break deploys again. */
    expect(vercel.framework).toBe("vite");
    expect(vercel.buildCommand).toBe("npm run build");
    expect(vercel.outputDirectory).toBe("dist");
  });
});
