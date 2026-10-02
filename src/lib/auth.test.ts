import { describe, expect, it } from "vitest";

import { bolehLewatiAuth, pesanGalatMasuk } from "./auth";

/* These two functions are the whole security surface of the sign-in screen,
   so they are tested directly rather than through the UI. A regression in
   `bolehLewatiAuth` would not fail any existing E2E spec — every spec would
   still pass, on a build that skips auth — which is exactly the kind of bug
   that survives to production. */

describe("bolehLewatiAuth", () => {
  it("izinkan bypass hanya di localhost dengan flag yang tepat", () => {
    expect(bolehLewatiAuth("localhost", "1")).toBe(true);
    expect(bolehLewatiAuth("127.0.0.1", "1")).toBe(true);
    expect(bolehLewatiAuth("::1", "1")).toBe(true);
  });

  it("tolak di host mana pun selain localhost walau flag terpasang", () => {
    /* The whole point: a forgotten flag on a real deployment must not open
       the app. These are the hostnames that would actually be served. */
    for (const host of [
      "kasir.shanticatering.com",
      "shanti-cashier.vercel.app",
      "localhost.evil.example",
      "127.0.0.1.evil.example",
      "",
    ]) {
      expect(bolehLewatiAuth(host, "1"), host).toBe(false);
    }
  });

  it("tolak di localhost kalau flag tidak tepat", () => {
    expect(bolehLewatiAuth("localhost", undefined)).toBe(false);
    expect(bolehLewatiAuth("localhost", "0")).toBe(false);
    expect(bolehLewatiAuth("localhost", "true")).toBe(false);
    expect(bolehLewatiAuth("localhost", "")).toBe(false);
    /* Anything truthy but not exactly "1" is a typo, not consent. */
    expect(bolehLewatiAuth("localhost", "yes")).toBe(false);
  });
});

describe("pesanGalatMasuk", () => {
  it("ubah pesan supabase jadi kalimat yang bisa ditindaklanjuti", () => {
    expect(pesanGalatMasuk("Invalid login credentials")).toMatch(/salah/i);
  });

  it("memberi tahu kalau email belum dikonfirmasi", () => {
    /* Distinct from a wrong password, because the fix is completely
       different: open the inbox, not retype the password. */
    expect(pesanGalatMasuk("Email not confirmed")).toMatch(/konfirmasi/i);
  });

  it("bedakan rate limit dari credential salah", () => {
    expect(pesanGalatMasuk("Too many requests")).toMatch(/menunggu|satu menit/i);
  });

  it("laporkan masalah koneksi secara terpisah", () => {
    expect(pesanGalatMasuk("TypeError: Failed to fetch")).toMatch(/koneksi/i);
  });

  it("jangan pernah kosong atau undefined", () => {
    for (const m of [undefined, "", "   ", null as unknown as string]) {
      const p = pesanGalatMasuk(m);
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/undefined|null|NaN/);
    }
  });

  it("bawa pesan asli kalau tidak dikenali, jangan menelan errornya", () => {
    expect(pesanGalatMasuk("Some new Supabase failure")).toMatch(/Some new Supabase failure/);
  });
});