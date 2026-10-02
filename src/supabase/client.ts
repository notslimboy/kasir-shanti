// Supabase client — env first, falling back to the values the app has used
// since it was built.
//
// URL and KEY are also exported because the data layer talks to PostgREST
// directly for pagination; supabase-js does not expose its base URL as a
// public property.
//
// A note on the publishable key: it is not a secret. It ships inside the
// built frontend, so anyone can read it from DevTools. That is by design —
// the only thing standing between that key and your customer data is RLS in
// the database. See supabase/migrations/0001_lock_down.sql.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://ddfalsclevkqhiyojngx.supabase.co";

export const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  "sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

/* --------------------------------------------------------------------------
   Access token cache.

   The raw `fetch` calls across the data layer need the signed-in user's JWT
   in `Authorization`, because the RLS policies granted to `authenticated`
   only match a real user token. The publishable key alone gets nothing.

   `headerRest()` is called from 40-odd places and is synchronous, so the
   token is cached here at module level rather than awaited at every call
   site. supabase-js refreshes the token shortly before it expires and fires
   `onAuthStateChange`, which keeps the cache fresh for the life of the tab.

   The cache is empty on the very first render, before the auth listener has
   reported the stored session. That is safe: the app renders nothing but the
   sign-in screen until a session exists, and `AuthGate` awaits the session
   before mounting the data layer at all.
   -------------------------------------------------------------------------- */

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Standard headers for direct REST calls. */
export function headerRest(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
  };
}