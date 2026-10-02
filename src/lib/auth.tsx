import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { setAccessToken, supabase } from "@/supabase/client";
import { cacheKosongkan } from "@/lib/cache-db";

/* ==========================================================================
   Sign-in state for the whole app.

   There is no anonymous access any more. Supabase RLS grants everything to
   `authenticated` and nothing to `anon`, so this provider decides one thing
   only: show the sign-in screen, or show the app.

   The data layer must not mount before a session exists. If it did, its
   first requests would go out with the publishable key and come back empty,
   and the cashier would be staring at an empty menu with no explanation.
   That is why the gate lives above `DataProvider`, not inside it.
   ========================================================================== */

export type StatusMasuk = "memuat" | "belum" | "masuk";

type AuthValue = {
  status: StatusMasuk;
  session: Session | null;
  masuk: (email: string, password: string) => Promise<string | null>;
  keluar: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/** Hosts allowed to skip sign-in. Anything else is refused outright. */
const HOST_LOKAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Whether the build is allowed to skip sign-in.
 *
 * Playwright serves the production build from `localhost`, so the E2E suite
 * would otherwise spend every test staring at the sign-in form. The
 * localhost check is the actual security control, not the env var: someone
 * who sets `VITE_E2E_AUTH_BYPASS=1` on a real deployment gets nothing,
 * because the deployed hostname is not localhost. Making the flag
 * self-defeating off-host means the failure mode of forgetting about it is
 * "tests need a real account", never "the app is open to the internet".
 */
export function bolehLewatiAuth(hostname: string, flag: string | undefined): boolean {
  return flag === "1" && HOST_LOKAL.has(hostname);
}

export function authBypassAktif(): boolean {
  if (typeof window === "undefined") return false;
  return bolehLewatiAuth(
    window.location.hostname,
    import.meta.env.VITE_E2E_AUTH_BYPASS as string | undefined,
  );
}

/**
 * Turn a Supabase auth error into something a non-technical staff member can
 * act on. Raw messages leak English enum names like `Invalid login
 * credentials`, which tells the user nothing about what to change.
 */
export function pesanGalatMasuk(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return "Terjadi kesalahan yang tidak diketahui. Coba lagi.";
  if (m.includes("invalid login credentials")) {
    return "Email atau password salah. Periksa lagi, pastikan tidak ada spasi atau huruf besar yang kelewat.";
  }
  if (m.includes("email not confirmed")) {
    return "Email ini belum dikonfirmasi. Cek inbox email itu untuk tautan konfirmasi.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi.";
  }
  if (m.includes("fetch") || m.includes("network")) {
    return "Tidak bisa menghubungi server. Periksa koneksi internet.";
  }
  return "Gagal masuk. " + (message ?? "");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusMasuk>(
    () => (authBypassAktif() ? "masuk" : "memuat"),
  );
  const [session, setSession] = useState<Session | null>(null);

  /* One listener for the whole app. It does three things: report whether
     anyone is signed in, hand the JWT to `headerRest()` for the raw REST
     calls, and react to a sign-out or a token refresh performed in another
     tab. */
  useEffect(() => {
    if (authBypassAktif()) return;

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setAccessToken(next?.access_token ?? null);
      setSession(next ?? null);
      setStatus(next ? "masuk" : "belum");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const masuk = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return pesanGalatMasuk(error.message);
    /* No setState here on purpose. `onAuthStateChange` fires for SIGNED_IN
       and drives `status`; setting it twice would let the data layer mount
       against a session state that has not caught up yet. */
    return null;
  }, []);

  const keluar = useCallback(async () => {
    await supabase.auth.signOut();
    /* The kiosk is shared. Leaving sales cached in IndexedDB would mean the
       next person to sign in sees the previous shift's data before the first
       request finishes — and if anyone signs in later than that, they get it
       for good. */
    setAccessToken(null);
    await cacheKosongkan();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, session, masuk, keluar }),
    [status, session, masuk, keluar],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}