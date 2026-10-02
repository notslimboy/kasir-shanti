import { useState, type FormEvent } from "react";

import { btnPrimary, inputClass } from "@/components/ui/kit";
import { useAuth } from "@/lib/auth";

/* ==========================================================================
   Sign-in screen.

   Shown instead of the app until someone signs in. Everything below is
   Indonesian because it is read by staff, not by developers, and the whole
   point of the screen is that nobody needs to understand Supabase to get
   through it.
   ========================================================================== */

export function MasukPage() {
  const { masuk } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [bekerja, setBekerja] = useState(false);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    if (bekerja) return;
    setGalat(null);

    const emailBersih = email.trim();
    if (!emailBersih || !password) {
      setGalat("Email dan password wajib diisi.");
      return;
    }

    setBekerja(true);
    try {
      const pesan = await masuk(emailBersih, password);
      if (pesan) setGalat(pesan);
    } catch {
      setGalat("Gagal masuk. Coba lagi.");
    } finally {
      setBekerja(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <main className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Shanti Catering</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Kasir</p>
        </div>

        <form
          onSubmit={kirim}
          className="rounded-3xl border border-border bg-card p-6 shadow-card"
        >
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Email
            </span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="kasir@shanticatering.com"
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Password
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
          </label>

          {/* role="alert" so the message is announced, not just shown. A
              cashier who mistypes a password with the screen reader off gets
              no feedback at all otherwise. */}
          {galat && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive"
            >
              {galat}
            </p>
          )}

          <button type="submit" disabled={bekerja} className={`${btnPrimary} mt-5 w-full`}>
            {bekerja ? "Memeriksa…" : "Masuk"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
          Belum bisa masuk? Hubungi owner Shanti Catering.
        </p>
      </main>
    </div>
  );
}

/** Shown while the stored session is being checked, before either branch is
 *  known. Deliberately unlabelled: it lasts well under a second, and a
 *  spinner that flashes text is more distracting than a quiet blank. */
export function LayarMemuatMasuk() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40"
      />
    </div>
  );
}