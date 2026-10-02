# WhatsApp Order Parsing Guardrails

This is the operating checklist for every AI or subagent that parses Shanti Catering WhatsApp orders. Read this before touching an order CSV. Business rules live in `../instruksi_ai_parser.md`; the active structured customer reference is `../customers.csv`.

## 0. Repository Tooling Preflight

Before parsing, inspect `../scripts/`, this `_forAI/` folder, and `../orderan/` read-only. The required pipeline is Python first, AI second: Python reads the complete exports and performs exact-range filtering, merging, deduplication, customer lookup, and candidate extraction; AI reads the compact generated evidence, audits ambiguity, and produces the final CSV. Never load complete `Chat1.txt` or `Chat2.txt` into model context. Read the existing `../customers.csv` snapshot immediately; routine parsing must not contact Supabase or wait for a customer refresh. Run `../update_customers_csv.py` separately only as scheduled maintenance or when the user explicitly requests fresh customer data. `customers.csv` is the active structured authority for canonical names, aliases, tags, and ongkir. Use `customer-terdeteksi.csv` to audit the strict match for every sender that has item candidates, and use `../kasir-bento.sqlite3` only for selective unresolved lookup. Do not run `match_draft_to_db.js` automatically because it may call Supabase and write output. Use a short-lived `scratch/` helper only when deterministic range filtering, CSV validation, stock reconciliation, or database lookup needs it; keep source/target CSV reads read-only until final QA, use Python `csv` for CSV output, and never delete user files.

## 1. Scope Contract Before Work

Record these internally before reading any source:

- requested output mode: `code block only`, `new CSV`, `append`, or explicit `replace`
- target filename, if the user asked for a file
- exact inclusive start and end timestamp
- required sources: `Chat1.txt`, `Chat2.txt`, screenshots, direct text, or a specified combination
- official menu for that order date
- limited-stock items and their stock count

For any exact date-time range, run `../scripts/prepare_order_parse_context.py` first with both timestamps and the menu provided by the user. Its generated bundle belongs only in `../orderan/hasil-parser/<date range>/` and reruns refresh that same folder. Review `review.md`, `hasil-parser.csv`, and `customer-terdeteksi.csv`, then verify every suggestion against every message in `chat-range.txt`; also read `menu.csv`, `run.json`, and optional `catatan-susulan.csv`/`stok-terbatas.csv`. Candidate links are review aids, not final orders, and never authorize editing a final order CSV. See `PARSER_RUNTIME_COMPACT.md` for the routine one-prompt workflow.

The newest explicit user instruction wins. Never carry a prior day, menu, filename, or write mode into a corrected request.

## 2. Source Coverage Rules

- A date-range audit must read both `Chat1.txt` and `Chat2.txt` in the exact requested range. They are one combined chronological source.
- Include only evidence inside the range. Do not use a nearby date, a day label such as `Hari Ini`, or an unrelated screenshot as a substitute for a timestamp.
- Parse screenshots only when the user explicitly asks to add their contents. A screenshot can repeat an already-recorded order; compare it before adding anything.
- If a screenshot/direct message has no reliable timestamp, leave `chatDate` blank and place it after timestamped records. Do not fabricate a time.
- Keep raw sender, raw timestamp, raw wording, amendments, payment confirmation, stock outcome, and delivery wording together until the order is verified.
- `Shanti Catering`/`Santi Catering` is the store account, never a customer order. Exclude it from customer/item/quantity candidates while retaining textual store announcements and confirmations as evidence.

## 3. Write-Mode Safety

| User wording | Required action |
| --- | --- |
| `code block aja`, `format CSV langsung` | Return CSV code block only. Do not change files. |
| `buat CSV baru` | Create a distinct file in `orderan/`. Do not edit an existing same-date CSV. |
| `tambahin ke CSV`, `append` | Preserve every existing row and add verified new rows only. |
| `replace`, `ganti seluruhnya`, `overwrite` | Replace only after the user says so explicitly. |

Before an append, record the existing data-row count. After writing, prove that no previous row disappeared and that the count increased by exactly the accepted new rows. If ascending sort is requested, sort the complete final file by each order group's latest accepted timestamp while keeping group rows consecutive.

## 4. Independent Agent Roles

1. **Source auditor - read only:** build a chronological manifest from all required sources.
2. **Parser - read only:** propose customer mapping, menu mapping, item notes, send notes, payment, and stock allocation.
3. **QA reviewer - read only:** independently compare the proposal to source evidence and challenge wrong dates, cross-sender merges, numeric address mismatches, duplicate rows, and stock over-allocation.
4. **Writer - only writer:** edit/create the CSV only after QA passes.

No two agents may write the same CSV. A parser or QA agent must not silently "fix" the target file.

## 5. Customer, Address, and Menu Safety

- Match official customer names only when location and all meaningful number tokens agree. Never map on name similarity or one matching number alone.
- If contact/address evidence conflicts, use `[PERLU REVIEW] <raw identities>` in `customer`, leave `ongkir` blank, and do not force a profile.
- Use exact item text from the supplied menu. A near spelling is not enough when it could be a different dish; mark the raw item for review or ask the user.
- Preserve kitchen notes such as `kuah banyak`, `matengan`, `tanpa lontong`, `paha`, and `gula dipisah` in `note`.
- Keep addresses in `customer`; alternative delivery/pickup instructions go in `sendNote`; never put address text into `note`.
- Default payment is blank. Use `Transfer`, `QRIS`, `Tunai`, or `Debit` only when that payment is explicitly confirmed for the same order.

## 6. Quantities and Stock

- Keep package suffixes such as `/ 3` inside the exact menu item; they are not order quantities.
- Quantity is numeric. Use `0.5` for a half portion when the menu has no separate official half-portion item.
- For every stock-limited item, make a ledger: requester, timestamp, requested quantity, acceptance/stock-out evidence, and final allocation.
- A menu addition starts at the exact official store-announcement timestamp. Requests before it are not eligible; later additions use their actual message time.
- After AI resolves edits/cancellations, run `../scripts/allocate_limited_stock.py`. FIFO allows partial fulfillment: if 2 remain from a request of 5, allocate 2 and report 3 unfulfilled.
- Never allocate above stock. A request followed by `habis`, `sudah diborong`, or equivalent is not a fulfilled item row.
- A clear later fulfillment statement overrides earlier unconfirmed requests. Do not invent the recipient of unaccounted remaining stock.
- Report allocation and rejected requests for each limited-stock item.

## 7. CSV QA Gate

Do not finalize until all checks pass:

- header is exactly `customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote`
- every data row has exactly 9 fields; commas in notes/send notes are semicolons or correctly quoted
- every item exactly matches today's menu; price stays blank unless explicitly custom
- quantity, payment, customer, ongkir, note, and send note are supported by source evidence
- additions/revisions from the same sender are merged once using their latest accepted timestamp
- repeated screenshots/rechats do not make duplicate orders
- all accepted groups are in ascending timestamp order and their item rows are consecutive
- append/new-file action matches the user's latest instruction and previous rows are safe

When anything remains uncertain, do not guess. Mark `[PERLU REVIEW]` or ask the user before writing.
