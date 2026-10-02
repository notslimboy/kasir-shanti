// Supabase client — env dulu, fallback ke nilai app lama.
//
// URL dan KEY ikut diekspor karena lapisan data memakai fetch langsung ke
// PostgREST untuk paginasi; supabase-js tidak mengekspos base URL sebagai
// properti publik.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://ddfalsclevkqhiyojngx.supabase.co";

export const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  "sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Header standar untuk panggilan REST langsung. */
export function headerRest(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
}
