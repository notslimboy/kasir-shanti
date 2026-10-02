# For AI Agents

Two parts in one repo: the **cashier app** (Vite + React + Supabase) and the
**WhatsApp order → CSV parser**. Parsing rules do not change because the app
stack changed; what changes is file location and which helper tools exist.

## Read In This Order

1. [`../instruksi_ai_parser.md`](../instruksi_ai_parser.md) — business-rule
   source of truth. Other documents follow it, none replaces it.
2. `PARSER_RUNTIME_COMPACT.md` — the one-prompt runtime flow, token-saving.
3. `ORDER_PARSING_GUARDRAILS.md` — the mandatory checklist: preflight, scope,
   write mode, agent roles, QA.
4. [`../AGENTS.md`](../AGENTS.md) — repo working rules for app coding and for
   parsing.
5. `recognizer-kit/fixtures/evaluation-cases.md` — only when the task is
   recognizer evaluation.

The **old stack** technical document (`server.py`, SQLite, `script.js`) lives in
[`../legacy/PROJECT_TECHNICAL_CONTEXT.md`](../legacy/PROJECT_TECHNICAL_CONTEXT.md).
That is a historical reference, not a description of this repo.

## Language Rule

Docs, reasoning, and review reports are English. CSV output is Indonesian:
menu names, `note`, `sendNote`, customer names, and addresses are copied
verbatim. Never translate or reword literal tokens — the CSV header,
`[PERLU REVIEW]`, status codes, payment values, and output filenames.

## WA → CSV Pipeline

```
Chat1.txt + Chat2.txt  ─┐
customers.csv          ─┼─► scripts/prepare_order_parse_context.py
menu (prompt/file)     ─┘        │
                                  ▼
              orderan/hasil-parser/<range>/
              chat-range.txt, hasil-parser.csv,
              customer-terdeteksi.csv, review.md,
              menu.csv, run.json, catatan-susulan.csv
                                  │
                                  ▼
                    AI interpretation (MANDATORY)
                    read ALL of chat-range.txt
                                  │
                                  ▼
                 QA gate ─► final 9-column CSV
```

Principle: **Python filters and structures; the AI audits and cleans.**
`hasil-parser.csv` holds candidates, not final orders. No two agents may write
the same CSV.

## Input Files (all in repo root, gitignored)

| File | Required | Origin |
| --- | --- | --- |
| `Chat1.txt` | yes | WhatsApp export |
| `Chat2.txt` | yes | WhatsApp export (continuation) |
| `customers.csv` | yes | `python3 update_customers_csv.py` |
| `instruksi_ai_parser.md` | yes | already in the repo |
| menu | yes | `--menu-line` from the user prompt, or `--menu-file menu-harian.csv` |
| `orderan/` | no | created by the script; parser output holder only |

Override chat filenames with `--chat` (exactly two). With a single export, pass
the same path twice.

`menu-harian.csv` is the app's menu export (formerly `clean_menu_sheet.csv`).
Its columns are `sku,nama,harga,stok,kategori,alias` — the script reads only
`nama`, `harga`, `stok`, and `alias`. **A menu that duplicates after
normalization (different spelling, only punctuation or spacing differs) aborts
the script with `Menu duplikat`** — merge those rows and keep the alternate
spelling in the `alias` column.

## Commands

```bash
# 1. evidence bundle for the inclusive range
python3 scripts/prepare_order_parse_context.py \
  --start "25/7/2026 19:00" --end "26/7/2026 12:00" \
  --menu-file menu-harian.csv

# or menu taken from the user prompt
python3 scripts/prepare_order_parse_context.py \
  --start "1/9/2026 08:00" --end "1/9/2026 20:00" \
  --menu-line "Nasi Goreng Rumahan|35000|unlimited" \
  --menu-line "Ayam Goreng|30000|15"

# 2. limited stock, after AI identity/revision/cancellation work is done
python3 scripts/allocate_limited_stock.py --help
```

Rerunning for the same range refreshes that bundle in place. The script never
touches a final order CSV.

## What Changed From The Old Version

- No `server.py`, no local SQLite, no `match_draft_to_db.js`. When a customer
  cannot be resolved locally, use `customers.csv`, or a read-only Supabase query
  through `src/supabase/client.ts` if truly needed.
- `update_customers_csv.py` pulls from **Supabase**, not a local database. Run
  it separately from routine parsing.
- The app reads CSV through `src/lib/impor-pesanan.ts`; the 9-column format and
  the `customer|chatDate|payment|ongkir` grouping rule are identical to the old
  Bulk Input, so `sample-bulk-orders.csv` works as-is.
- Menu and chat snapshots are not in the repo.
