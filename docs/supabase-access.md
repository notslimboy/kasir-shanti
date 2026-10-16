# Supabase access setup

The app used to talk to Supabase with no sign-in at all. Anyone who loaded
the page got the publishable key out of DevTools and could read or delete the
whole database with `curl`.

This is the setup that closes it. One shared account, no anonymous access.

## Why one shared account

Agreed with the owner: a single account, credentials handed to the owner and
the admins who need them. There are no roles to configure, because every
person who should see the data already sees all of it.

What that means concretely, and be clear-eyed about it:

- **One leaked password exposes everything.** There is no per-person revocation.
- **There is no audit trail.** Every sale is attributed to the same account,
  so you cannot tell who rang it up.
- **Signing someone out is not possible.** You can only change the shared
  password, which logs everyone out at once.

Both are acceptable at this size. If the shop grows staff who should *not* see
the financials, revisit this — a `staff` role and a `sales` table with an
`auth.uid()` owner column is the next step, not a bigger refactor.

## Why the publishable key stays in the code

`src/supabase/client.ts` still ships the publishable key in the bundle. That
is correct and is not a leak. Supabase publishable keys are designed to be
public. The key is only a *label* saying "I am `anon`"; RLS is what decides
whether `anon` may see anything, and after this setup the answer is no.

What actually protects the data:

1. RLS enabled on every table, with policies granted to `authenticated` only.
2. `anon` grants revoked outright, so a wrong policy still cannot help it.
3. Nothing renders until Supabase Auth reports a live session.

## Setup

Two steps, and the order is not negotiable.

### Step 1 — create the login

1. Supabase Dashboard → **Authentication** → **Users** → **Add user**.
2. Enter the email and a password. Use something long; you will be typing it
   on a tablet.
3. Tick **Auto Confirm User**. Without it the app rejects the sign-in with
   "Email not confirmed" and there is no in-app way to confirm.
4. Leave **Email Provider** alone. The app only ever calls
   `signInWithPassword`; no email is sent during normal use.

### Step 2 — lock it down

Copy the whole of `supabase/migrations/JALANKAN-INI.sql` into **SQL Editor**
→ **New query** → **Run**. One paste, one run.

It is `0001` and `0002` combined, plus a report at the end. It refuses to run
against any database that is not the cashier one, copies the old policies into
`public._policy_backup_20260101` before deleting them, and wraps everything in
a transaction — so a failure halfway leaves the database untouched.

Read the `NOTICE` output. It ends with one of:

```
STATUS: BERHASIL. Database sudah tertutup.
STATUS: BELUM SEMPURNA. Baca baris GAGAL di atas.
```

If it says `BELUM SEMPURNA`, the line above it names the exact tables or
functions that are still open. Copy that into an issue rather than re-running.

### Optional — audit first

`0000_audit.sql` is read-only and changes nothing. Run it if you want a record
of what the setup looked like beforehand. Section 4b is worth reading even if
you skip the rest: a view can leak everything regardless of table RLS.

## Verify it worked

With the app closed, run:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://ddfalsclevkqhiyojngx.supabase.co/rest/v1/customers?select=id&limit=1' \
  -H 'apikey: sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP' \
  -H 'Authorization: Bearer sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP'
```

Expect `401`. Before the lockdown it returned `200` along with a real customer
name and address.

The same for `sales`, `sale_items`, `sale_payments`, `products`,
`product_variants`. Any `200` means that table is still open.

Then open the app, sign in, and confirm the numbers load.

## Sharing the password

The account is shared, so the password is now a shared secret that lives on
shared devices.

- One account per person is not possible here by design, but a **separate
  browser profile per person** is worth doing anyway. It keeps each person's
  cached session separate on a shared tablet.
- **Sign out** when you hand the tablet over. The button is in the top bar.
  Signing out also clears the local data cache, so the next person cannot see
  the previous shift's numbers before the first request lands.
- **Do not** put the password in the app, in a URL, or in a shared note that
  ends up in the repo.

## Scripts that talk to Supabase directly

`update_customers_csv.py`, `scripts/tag_customer_supabase.py` and
`scripts/tandai_belum_lunas.py` run in a terminal, not in a browser, so they
cannot use a signed-in session and the publishable key no longer works. They
read the service-role key from the environment:

```bash
export SUPABASE_KEY='sb_secret_...'   # Dashboard → Project Settings → API Keys
```

`scripts/tandai_belum_lunas.py` also reads the same variable from `.env.local`
or `.env` (both gitignored), which keeps the key out of shell history:

```bash
SUPABASE_KEY=sb_secret_...            # in .env.local
```

The service-role key bypasses RLS entirely. Keep it in `.env` (gitignored),
never in a committed file, and rotate it if it ever leaks.

Without the variable both scripts now stop with an explanation instead of
failing obscurely, and neither will write an empty file over `customers.csv`.

`scripts/tandai_belum_lunas.py` writes, but only when asked. It is the bulk
form of the Piutang page's "Belum lunas" action — it corrects the customer
deposit, deletes the `sale_payments` rows and recomputes `paid_amount` from
what is left. Run it without `--tulis` first; the dry run reports the same
counts it would write.

```bash
python3 scripts/tandai_belum_lunas.py --dari 2026-08-01          # dry run
python3 scripts/tandai_belum_lunas.py --dari 2026-08-01 --tulis  # writes
```

## Env vars in the app build

Optional — the app falls back to the values inlined in
`src/supabase/client.ts`:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

`VITE_E2E_AUTH_BYPASS` exists for the Playwright suite and is refused unless
the page is served from localhost. It cannot open up a real deployment.

## Rolling back

If you need the old behaviour back, re-run `0001_lock_down.sql` after
dropping the new policies — or restore from `_policy_backup_20260101`.
Prefer fixing forward: the lockdown is what makes the public deploy
defensible.