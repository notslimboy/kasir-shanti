# AGENTS.md — Kasir Shanti

This repo has two halves that depend on each other:

| Part | Contents |
| --- | --- |
| `src/`, `e2e/` | Cashier app — Vite + React 19 + TypeScript, data in Supabase |
| `instruksi_ai_parser.md`, `scripts/`, `_forAI/`, `recognizer-kit/` | WhatsApp order → CSV parser |

They fail when separated: the parser produces CSV that `src/lib/impor-pesanan.ts`
must read, and the app needs the same customer data the parser uses.

Start with `_forAI/README.md` for the parser side.

## Language Rule (applies to every agent)

- Docs, code, comments, reasoning, review reports: **English**.
- CSV output: **Indonesian, verbatim**. `item` exactly as the menu writes it,
  `note`/`sendNote` as the chat phrased it, `customer` as the canonical name in
  `customers.csv`.
- Literal tokens are never translated or reworded: the CSV header,
  `[PERLU REVIEW]`, status codes (`UNIQUE_STRICT_MATCH_AI_CONFIRM`,
  `UNMATCHED_AI_REVIEW`, `AMBIGUOUS_EXACT_AI_REVIEW`), payment values
  (`Transfer`, `QRIS`, `Tunai`, `Debit`), output filenames
  (`Order-tanggal 4 Jul 2026.csv`).

---

# Part 1 — WhatsApp Order Parsing

## ⚠️ Critical Failure Log (4 Aug 2026)

### What Went Wrong

An agent produced an incomplete order CSV because it **relied only on script
output** (`hasil-parser.csv`) and skipped the **AI interpretation stage** over
`chat-range.txt`.

**Missed orders:**
- "Oseng tahu udang taoco" → missed (script expected exact "Oseng Tahu Tauco")
- "Lele grng" → missed (abbreviation did not match)
- "mendol" → missed (colloquial for "Tempe Mendol")
- "soto daging", "dawet", "rujak matengan" → missed
- Donat orders → completely missed

### Root Cause

1. **Skipped mandatory reading** — `PARSER_RUNTIME_COMPACT.md` and
   `ORDER_PARSING_GUARDRAILS.md` were never read.
2. **Misunderstood the pipeline** — script output was treated as final orders.
   Actually:
   - Stage 1: Python = deterministic filtering + candidate extraction
   - Stage 2: AI = interpretation, fuzzy matching, manual verification against
     `chat-range.txt`
   - Stage 3: AI = final CSV generation
3. **Exact matching trap** — the script uses strict regex; the AI must
   compensate with contextual interpretation.

### The Correct Flow

```
User request
    ↓
Read instruksi_ai_parser.md + _forAI/*.md (MANDATORY)
    ↓
python3 scripts/prepare_order_parse_context.py --start ... --end ... --menu-file menu-harian.csv
    ↓
Read review.md + hasil-parser.csv (candidates only)
    ↓
**CRITICAL: read ALL of chat-range.txt**
    ↓
AI fuzzy match: "lele grng" → "Lele Goreng /3"
                "taoco" → "tauco"
                "mendol" → "Tempe Mendol"
    ↓
Verify identity against customers.csv
    ↓
QA gate → final CSV
```

### Golden Rules

1. **Never trust script output blindly** — `hasil-parser.csv` holds candidates,
   not orders.
2. **Read `chat-range.txt` completely** — every message must be reviewed.
3. **Fuzzy matching is the AI's job** — typos, abbreviations, colloquial terms.
4. **Read `_forAI/` first** — before `instruksi_ai_parser.md`.
5. **When in doubt, audit the source** — if numbers disagree, read the raw chat
   evidence (through `chat-range.txt`, never by loading `Chat1.txt`/`Chat2.txt`
   in full).

### Customer Matching Lessons

❌ Do NOT stop at an UNMATCHED row in `customer-terdeteksi.csv`
✅ DO search `customers.csv` for partial matches ("Bhas 7/17" →
   "Bhaskara 7/17")

❌ Do NOT assume the sender name is the customer
✅ DO check the message body for address phrases ("Bhaskara 7/17" in the body)

### Menu Matching Lessons

The script looks for exact menu names. The AI must handle:
- Abbreviations: "grng" → "Goreng", "mendol" → "Tempe Mendol"
- Typos: "taoco" → "tauco"
- Partial names: "soto daging" → "Soto Madura" (with note "daging")
- Context clues: "soto" + "daging tnp jerohan" = Soto Madura

### Verification Checklist

- [ ] Distinct sender count in `chat-range.txt` equals the count in the final CSV
- [ ] Every sender with food keywords has order rows
- [ ] Abbreviations mapped to full menu names
- [ ] `[PERLU REVIEW]` added for ambiguous customers
- [ ] Notes extracted: tanpa lombok, kuah banyak, matengan, and so on

## Parsing SOP

### Phase 1 — Preparation (script)

```bash
python3 scripts/prepare_order_parse_context.py \
  --start "25/7/2026 19:00" --end "26/7/2026 12:00" \
  --menu-file menu-harian.csv
```

Input: `Chat1.txt`, `Chat2.txt`, `customers.csv`, menu.
Output: bundle in `orderan/hasil-parser/<range>/`.

Menu supplied as prompt lines instead:

```bash
python3 scripts/prepare_order_parse_context.py \
  --start "1/9/2026 08:00" --end "1/9/2026 20:00" \
  --menu-line "Nasi Goreng Rumahan|35000|unlimited" \
  --menu-line "Ayam Goreng|30000|15"
```

### Phase 2 — AI Interpretation (MANDATORY)

1. Read `_forAI/PARSER_RUNTIME_COMPACT.md`
2. Read `_forAI/ORDER_PARSING_GUARDRAILS.md`
3. Read `review.md` for the sender groups
4. **Read every message in `chat-range.txt`**
5. Cross-reference `customers.csv` for fuzzy address matching
6. Map colloquial/abbreviated items to the official menu
7. Consolidate additions/revisions per sender
8. Resolve `[PERLU REVIEW]` cases

### Phase 3 — CSV Generation

- Exact 9-column header:
  `customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote`
- Sort order groups ascending by each group's final order timestamp
- QA: row count, no duplicates, exact menu names

### Limited Stock (optional, after Phase 2)

```bash
python3 scripts/allocate_limited_stock.py --help
```

Input: `stock_events.csv` (`item,availableFrom,stock,source`) and
`stock_requests.csv`
(`customer,requestTime,item,requestedQty,note,source`).
FIFO allocation; partial allocation is mandatory
(`allocated = min(requested, remaining)`).

## Parser Input Files

All in the repo root and **gitignored** (real customer data):

| File | Status | How it is produced |
| --- | --- | --- |
| `Chat1.txt` | copied over from the old repo | WhatsApp export |
| `Chat2.txt` | copied over from the old repo | WhatsApp export |
| `customers.csv` | copied over from the old repo | `python3 update_customers_csv.py` |
| `menu-harian.csv` | copied over from the old repo | app menu export |
| `orderan/` | present (`.gitkeep`) | created by the script |

> If `customers.csv` is missing: `python3 update_customers_csv.py` (pulls from
> Supabase). **Never** run it in the routine parsing path — it is separate
> maintenance and needs the network.

> `menu-harian.csv` originally shipped both `Gado-Gado` and `Gado Gado`, which
> collide after normalization and abort the script with `Menu duplikat`. They
> are merged here, with `Gado Gado` kept as an alias. If that error appears,
> look for the same kind of duplicate in the menu file.

## Invariants That Must Not Break

> Python filters and structures; **the AI audits and cleans.**
>
> The agent must never load `Chat1.txt` or `Chat2.txt` in full into model
> context. The AI **must** read all of `chat-range.txt` for interpretation.

The script is a filter, not a parser. The AI is the parser.

- Only one agent writes a CSV. Source auditor, parser, and QA reviewer are
  read-only.
- Write modes are literal: `code block aja` writes nothing, `buat CSV baru`
  creates a new file, `tambahin` appends and preserves every old row, and
  replace requires the word `replace`/`overwrite` from the user.
- If evidence does not settle a case, stop and ask. A wrong address is worse
  than one order held for review.

## Known Limits

- Auth exists but is deliberately coarse: one shared account, so a leaked
  password exposes everything and no sale can be attributed to a person.
  Fine at this size; revisit if staff who must not see financials appear.
- The Playwright suite runs with sign-in bypassed and therefore with an empty
  dataset — it asserts empty-state behaviour, never live numbers.
- `prepare_order_parse_context.py` has no tests. All 430 unit tests cover app
  logic only.
- `legacy/PROJECT_TECHNICAL_CONTEXT.md` describes the old stack (`server.py`,
  SQLite, `script.js`) and does **not** describe this repo.

---

# Part 2 — Cashier App

## Commands

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run verify     # typecheck + unit + E2E

npm test           # 430 unit test
npm run e2e        # 35 E2E + audit a11y
```

E2E runs against `vite preview`, not the dev server, so what is tested is the
build that hosting actually serves.

## Deploy

Static SPA on Vercel. `vercel.json` rewrites `/(.*)` → `/index.html`; without it,
opening `/kasir` directly returns 404 while sidebar navigation still works.

Optional env (defaults are inlined in `src/supabase/client.ts`):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Auth

There is no anonymous access. Supabase Auth gates the app, RLS grants
everything to `authenticated` and nothing to `anon`, and `headerRest()` sends
the signed-in user's JWT so the raw REST calls pass the same policies.

- One shared account for the owner and the admins. No roles, by agreement.
- `src/lib/auth.tsx` owns session state. `App.tsx` renders `MasukPage` until a
  session exists, and `DataProvider` mounts **inside** that gate — move it out
  and the first fetches go out unauthenticated and every page shows an empty
  menu.
- The publishable key in `src/supabase/client.ts` is not a secret and must not
  be treated as one. RLS is the entire security boundary.
- `VITE_E2E_AUTH_BYPASS` is honoured only on localhost, so it cannot open up a
  real deployment. Playwright builds with it set.
- `update_customers_csv.py` and `scripts/tag_customer_supabase.py` cannot use a
  browser session; they read a service-role key from `SUPABASE_KEY`.

Setup, rollback and verification: `docs/supabase-access.md`.
SQL: `supabase/migrations/`.

## Structure

```
src/app/            React entry + auth gate
src/pages/          beranda, kasir, menu, penjualan, piutang, customer,
                    impor-pesanan, pengaturan, masuk
src/components/     UI components (shadcn-style plus the Shanti kit)
src/lib/            domain logic — impor-pesanan, struk, pricing, sync, and so on
src/supabase/       client + types
supabase/migrations/  RLS and auth SQL. JALANKAN-INI.sql is the one to
                    paste; the numbered files are its parts, kept separate
                    for review
docs/               setup guides
scripts/            Python scripts for the parser
_forAI/             agent knowledge for parsing
recognizer-kit/     recognizer evaluation
legacy/             old stack documentation — does not describe this repo
```

## Conventions

- `src/lib/*.ts` holds pure logic with a colocated `*.test.ts`;
  `src/pages/*.tsx` and `src/components/*.tsx` hold UI only.
- `npm run typecheck` is plain `tsc -b`. Do not add `--noEmit false`: it
  overrides `noEmit: true` and emits JS into `src/`, where vitest then picks
  up every `*.test.ts` a second time as a stale `.js` twin — the suite
  reports double the tests and none of the failures are real.
- E2E specs that need data use `pakaiSupabasePalsu` from
  `e2e/fixture-supabase.ts`. Nothing in `e2e/` may read the live database:
  after the RLS lockdown the publishable key gets nothing, so such a spec
  passes on an open database and fails on a secured one — the deploy gate
  would break the build that makes the database safe.
- CSV import and order grouping follow the old Bulk Input
  (`groupKey = customer|chatDate|payment|shipping`). Do not change the 9-column
  format.
- Every new struk — from Kasir and from Import Pesanan alike — is written with
  `paid_amount = 0`, so it starts as **Belum Lunas**. Payment is recorded from
  the Piutang page. Status is derived (`paid_amount >= total`), so writing the
  total at creation silently erases the debt; do not restore that.
- Visual tokens and rules live in `DESIGN.md`. Values are sampled from pixels in
  `design/reference.png`, never guessed.
- Never commit `customers.csv`, `Chat*.txt`, `orderan/`, or
  `playwright-report/`. They are gitignored, but check `git status` before
  committing anyway.

## Deploy Gate

1. Supabase RLS closed — `supabase/migrations/JALANKAN-INI.sql` applied, and
   the `curl` check in `docs/supabase-access.md` returns `401`.
2. `npm run verify` green.
3. `git status` free of sensitive files.
4. No Supabase key in the deployed bundle except the publishable one. The
   publishable key is meant to be public; `sb_secret_` in `dist/` is a
   credential leak.
