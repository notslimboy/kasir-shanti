# Kasir Shanti

The cashier (POS) app for Shanti Catering, plus the WhatsApp order parser. Two
complementary parts in one repo:

| Part | Contents |
|---|---|
| `src/`, `e2e/` | Cashier app — Vite + React 19 + TypeScript, data in Supabase |
| `instruksi_ai_parser.md`, `scripts/`, `_forAI/`, `recognizer-kit/` | WhatsApp order → CSV parser |

They fail when separated: the parser produces CSV that the app must read, and the
app needs the same customer data the parser uses.

Start with [`AGENTS.md`](AGENTS.md) for working rules, then
[`_forAI/README.md`](_forAI/README.md) for the parser side.

## Deploy

Hosted on **Vercel** as a static SPA. This repo is **not** GitHub Pages — the old
version (vanilla JS + service worker) stays there and its codebase is untouched.

Required Vercel settings:

```
Root Directory : /            (repo root — not a subfolder)
Build Command  : npm run build
Output         : dist
Branch         : feat/next-stack
```

`vercel.json` rewrites `/(.*)` → `/index.html`. Without it, opening `/kasir`
directly returns 404 — sidebar navigation still works, which makes the error easy
to miss during manual testing.

### Before deploying: Supabase RLS

This app has **no authentication at all**. Anyone with the URL can read, change,
and delete data. Closing Supabase RLS is **mandatory** before this goes public —
`DELETE /customers` with the anon key wipes all customer and order data.

Optional env (clients fall back to the values inlined in
`src/supabase/client.ts`):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run verify     # typecheck + unit + E2E
```

Tests:

```bash
npm test           # 430 unit test
npm run e2e        # 35 E2E + a11y audit
```

E2E runs against `vite preview`, not the dev server, so what is tested is the
build that hosting actually serves rather than HMR behaviour.

## Customer Data

The parser reads `customers.csv` as its active reference. **That file is not in
the repo** — it holds 266 real customer names and addresses, so it is gitignored.
Its column shape is in [`customers.csv.example`](customers.csv.example).

Recreate it with:

```bash
python3 update_customers_csv.py      # Supabase → customers.csv
```

Routine parsing must not run this sync or wait for the network. Customer
maintenance is separate work.

## WhatsApp Order Parser

The parsing rules live in
[`instruksi_ai_parser.md`](instruksi_ai_parser.md). That document is the primary
source — other documents follow it, none replaces it.

Anyone doing parsing must read, in this order:

1. [`instruksi_ai_parser.md`](instruksi_ai_parser.md) — the main rules
2. [`_forAI/PARSER_RUNTIME_COMPACT.md`](_forAI/PARSER_RUNTIME_COMPACT.md) — runtime summary
3. [`_forAI/ORDER_PARSING_GUARDRAILS.md`](_forAI/ORDER_PARSING_GUARDRAILS.md) — mandatory checklist
4. `recognizer-kit/fixtures/evaluation-cases.md` — only for recognizer evaluation

Principle: **Python filters, the AI audits.** Local scripts must not read raw
chats into model context.

```bash
python3 scripts/prepare_order_parse_context.py --help
python3 scripts/allocate_limited_stock.py --help
```

Output lands in `orderan/hasil-parser/<date range>/` (gitignored) — those are
candidate files, not final orders. `allocate_limited_stock.py` runs only after the
AI has settled identities, revisions, and cancellations.

`Chat1.txt` / `Chat2.txt` are gitignored too: they hold private customer
conversations and are used only as local input.

## Structure

```
AGENTS.md               repo working rules for agents
src/                    cashier app
e2e/                    Playwright E2E + a11y audit
scripts/                Python scripts for the parser
_forAI/                 agent knowledge for parsing
recognizer-kit/         recognizer evaluation
legacy/                 old stack documentation — does not describe this repo
instruksi_ai_parser.md  primary parsing rules
update_customers_csv.py sync customers.csv from Supabase
DESIGN.md               app design system
```

## Not Done Yet

- **No authentication.** See the RLS section above.
- **No parser tests.** All 430 unit tests cover app logic;
  `prepare_order_parse_context.py` has none.
- **`legacy/PROJECT_TECHNICAL_CONTEXT.md` describes the old stack**
  (`server.py`, SQLite, `script.js`) and does not describe this repo. Use it as a
  historical reference only.
