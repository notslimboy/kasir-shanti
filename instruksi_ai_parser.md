# WhatsApp Order Parser Instructions (AI)

This document is the primary rule set for turning Shanti Catering WhatsApp
orders into cashier CSV. The customer list is not stored here: `customers.csv`
is the structured local snapshot used directly during parsing. Supabase is the
upstream source for customer data maintenance.

> AI handoff: read this document, `_forAI/PARSER_RUNTIME_COMPACT.md`, and
> `_forAI/ORDER_PARSING_GUARDRAILS.md`. For recognizer evaluation use
> `recognizer-kit/fixtures/evaluation-cases.md`.

## Language Rule

- Instructions, reasoning, and review reports are written in English.
- **CSV output stays Indonesian.** Menu names, `note`, `sendNote`, customer
  names, and address wording are copied verbatim from the menu, `customers.csv`,
  and the chat. Never translate a menu item, a kitchen note, or an address.
- Literal output tokens are never translated or reworded: the CSV header,
  `[PERLU REVIEW]`, match-status codes such as `UNIQUE_STRICT_MATCH_AI_CONFIRM`,
  payment values (`Transfer`, `QRIS`, `Tunai`, `Debit`), canonical customer
  names, and output filenames.

## Minimum Prompt

The user only needs to give the full range and the menu:

```text
Pakai instruksi_ai_parser.md.
Cek Chat1.txt dan Chat2.txt dari 25 Jul jam 19:00 sampai 26 Jul jam 12:00.

Menu hari ini:
- Menu A - 35000
- Menu B - 5000 - stok 15

Buat CSV baru dan sort ascending.
```

The agent must not ask the user to run commands. The agent runs the whole
preflight, audit, and QA itself.

## Mandatory Flow

Token-saving principle: **Python filters and structures; the AI audits and
cleans.** The agent must never load `Chat1.txt` or `Chat2.txt` in full into the
model context. Only the local script reads those two raw files.

1. Lock the scope: the user's latest instruction, output mode, target file,
   inclusive start and end timestamps, menu, stock, and screenshot sources when
   requested.
2. Use the existing `customers.csv` directly. Routine parsing must not run a
   Supabase sync or wait for the network. `update_customers_csv.py` runs only as
   separate scheduled maintenance or when the user explicitly asks for a
   customer data refresh.
3. Run `scripts/prepare_order_parse_context.py` to merge, deduplicate, and cut
   `Chat1.txt` + `Chat2.txt` by time.
4. Audit `customer-terdeteksi.csv`, `hasil-parser.csv`, and `review.md`, then
   use the already-trimmed `chat-range.txt` to verify evidence. Read the
   relevant parts first; never go back to the two raw chat exports. Candidate
   files are not final orders.
5. The AI cleans orders, additions, revisions, cancellations, notes, delivery,
   payment, customer, shipping, and limited stock.
6. Run the full QA gate, then emit or write the final CSV.

The work bundle lives in `orderan/hasil-parser/<date range>/` and must never
modify a final order CSV. Its main files:

- `chat-range.txt`: all chat evidence inside the range.
- `hasil-parser.csv`: item, qty, note, customer, and shipping candidates.
- `customer-terdeteksi.csv`: one row per sender that has item candidates.
- `review.md`, `menu.csv`, and `run.json`.
- `catatan-susulan.csv` or `stok-terbatas.csv` only when relevant.

## Sources and Scope

- `Chat1.txt` and `Chat2.txt` must be inspected as one chronology. If either is
  missing, empty, or unreadable, do not finalize.
- Only messages between the inclusive start and end timestamps may enter.
- `Hari Ini`, `Kemarin`, a group title, or a filename is not an order timestamp.
- Sender `Shanti Catering`/`Santi Catering` is the store account. Never treat it
  as a customer or an order; its messages are evidence for menu, stock,
  corrections, and sold-out only.
- Clean export tags such as `gambar tidak disertakan`, but never discard other
  order items in the same message.
- Admin separator messages containing only lines/underscores/equals signs are
  ignored entirely.
- Screenshots/direct text are a source only when the user asks to include them.
  Never pull in another chat that happens to be visible.
- Never invent timestamps. Orders without a valid time are placed after the
  timestamped orders and flagged for review.

## Customer, Address, and Shipping

For parsing, `customers.csv` is the active reference for names, aliases, tags,
and shipping. Supabase is upstream and refreshes that snapshot through separate
maintenance (`update_customers_csv.py`). If `customers.csv` is not enough, a
selective read-only Supabase query is allowed; there is no local SQLite
snapshot in this repo anymore. If sources conflict, never pick silently — use
`[PERLU REVIEW]` or ask the user.

- An address is a unique identity. Match only when the sender name/alias matches
  exactly or a complete address phrase matches `customers.csv` exactly.
- All meaningful location tokens, especially block, alley, street, and house
  number, must agree. Fuzzy matching from one number or one similar word is
  forbidden.
- Forbidden examples: `Pantai Mentari SF 9` must not become `ITS U 9`; `H 18`
  must not become `Villa Royal C4/18`; `Tohir 23` must not become `BPD B/23`;
  `Sutorejo 2/6` must not become `Kalijudan 2/6`.
- **Digits identify the unit and are never negotiable.** `ITS U 180` and
  `ITS U 80` are two different units and two different people. Spelling,
  spacing, punctuation, and case may be normalized; a number may not be
  shortened, extended, or matched loosely. `U 180` may resolve to `ITS U 180`
  because the letters and all numbers agree. `U 180` must never resolve to
  `ITS U 80` — and never to `ITS U 1800`. When the numbers disagree, the
  answer is `[PERLU REVIEW]`, never the closest match.
- `customer-terdeteksi.csv` is safe only at status
  `UNIQUE_STRICT_MATCH_AI_CONFIRM`. Status `UNMATCHED_AI_REVIEW` or
  `AMBIGUOUS_EXACT_AI_REVIEW` must be reviewed, never forced.
- A safe customer is written with the canonical name from `customers.csv`;
  shipping and tag come from that same row. Empty shipping is only for review.
- Never merge two different senders even when their addresses look similar.
- If a registered customer asks for delivery to another address, `customer`
  stays the official profile and the alternative destination goes into
  `sendNote` on every item of that order.

### ITS and Special Cases

- A clear ITS block address is normalized to `ITS <BLOCK> <NUMBER>`;
  separators `/`, `-`, spaces, and the word `Blok` count as equivalent only when
  the letters and all numbers are identical.
- Never invent an ITS block format for a person/department name without a clear
  block+number. Use the official alias or review.
- Official aliases: `Alfita/Alftita` -> `ITS T 71`; `Catur SPKB` -> `ITS W 20`;
  `Gatot` -> `ITS T 29`; `J5 Endah` -> `ITS J 5`; `N11 Tanti` -> `ITS N 11`;
  `Yulfi` -> `ITS T 99`; `X 26 Bu Iis` -> `ITS X 26`.
- `ITS D 19`/`SDMO Teknik`: customer `ITS D 19`; destination `SDMO` goes into
  `sendNote` when mentioned.
- `ITS D 24` is different from `BPD D 24/25`. Choose BPD only when `BPD` or the
  `24/25` range is clearly stated.
- `WPT IX/JJ-37` is Wisper, not ITS.
- `Emi Bumi Marina`: the Teknik Fisika destination uses shipping `5000`; the
  Bumi Marina destination uses `15000`. The destination goes into `sendNote`; if
  unclear, review.

## Item, Quantity, and Consolidation

- `item` must be exactly the Menu Hari Ini name, including capitalization,
  spacing, and package suffixes such as `/ 3` or `/ 20 bj`.
- A package suffix number is the content of one portion, not the quantity.
  `Ayam / 3` ordered twice means item `Ayam / 3`, quantity `2`.
- Menu items with similar spelling but different food must not be merged, e.g.
  `Mendoan` and `Mendol`. An uncertain item becomes
  `[PERLU REVIEW] <raw item>`.
- A clear item without a quantity means `1`. Quantity must be numeric.
- Half portions use the official variant: `varian` = `Separuh`, `quantity` = `1`.
  Never write `quantity 0.5`. The 9-column format has no `varian` column, so a
  half portion cannot be expressed at all — write the full item name and put
  `setengah porsi` in `note`. The app converts the note, reads the `Separuh`
  variant price from its menu, and holds the draft when the menu has no
  `Separuh` variant.

  Reason, do not "simplify" this: the `Separuh` variant has a Rp 10.000 floor
  (`halfVariantPrice`). `quantity 0.5` times the normal price skips that floor,
  so every half portion of an item under Rp 20.000 loses Rp 5.000 silently.
  `Tempe Mendol` 10.000 becomes 5.000 instead of 10.000.
- The `Jumbo` variant is used only when it exists in the menu; if not, write
  `porsi jumbo` in `note`.
- The same item with a different note must become separate rows. If a note
  applies to only part of the quantity, split the quantity into correct rows.
- An identical resend without an addition/revision is not a second order.
- Additions/revisions from the same sender are merged into one order. Sum the
  same items only when the note is the same. Use the timestamp of the last
  accepted order message as the group `chatDate`.
- Cancellations and corrections beat the earlier message.
- Implicit messages such as `ini 2` must be traced to the nearest
  reply/context. If two items are equally possible, review; do not guess.
- Follow-ups such as `tidak pedas`, `kuah banyak`, `paha` attach only to the
  nearest compatible item of the same sender, not to every item.

## Note, Send Note, Payment, and Price

- `note`: per-item kitchen instruction, e.g. `tidak pedas`, `kuah banyak`,
  `paha`, `sambal dipisah`. Never put an address here.
- `sendNote`: destination, courier, pickup, or handover instruction, e.g.
  `diambil`, `GOJEK`, `titip satpam`, or `kirim ke Teknik Fisika`. Repeat it on
  every item of the same order.
- Separate commas inside note/sendNote with semicolons, or use correct CSV
  quoting so columns do not shift.
- `payment` stays empty unless explicitly confirmed for the same order:
  `Transfer`, `QRIS`, or `Tunai`.
- `harga` stays empty for normal menu prices. Fill it only when the customer
  gave a manual/custom price that must be preserved.

## Limited Stock and Menu Additions

- Record requested qty, actual timestamp, customer, confirmation, rejection,
  cancellation, allocated qty, and remainder for every limited item.
- A newly added menu item is available from the official store-announcement
  timestamp. Requests before that time do not enter the queue.
- After the AI resolves identities, revisions, and cancellations, use
  `scripts/allocate_limited_stock.py` for deterministic FIFO.
- Partial allocation is mandatory: `allocated = min(requested, remaining)`.
- Explicit evidence such as `habis`, `tidak kebagian`, or one customer buying
  the remainder beats raw FIFO assumptions. Never output an unfulfilled item.
- Never invent a recipient for leftover stock. Report recipients, rejected
  requests, total allocated, and remaining.

## Write Modes and CSV Format

The required header, in this exact order:

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
```

- One item = one row. Repeat customer, chatDate, payment, shipping, and sendNote
  on every item of the same order.
- Time format: `dd/mm/yyyy HH.MM.SS` with a four-digit year.
- Sort order groups ascending by the group's last order timestamp; all rows of
  one order must stay consecutive.
- `code block/format saja`: do not create a file.
- `buat CSV baru`: create a new file in `orderan/`; do not touch a similar file.
- `tambahin/append`: keep every old row, add only verified new rows, then sort
  if requested. Record the row count before and after.
- Replace/overwrite only when the user says it explicitly.
- Filenames: `Order-tanggal 4 Jul 2026.csv` or
  `Order-tanggal 3 - 4 Jul 2026.csv`.

## QA Gate Before Finalizing

Do not finalize until every check below passes:

1. Both chats were read in the correct inclusive range; no order outside the
   range, no missed order, no duplicate.
2. Every ordering sender is listed in `customer-terdeteksi.csv`; address, all
   location numbers, official customer, and shipping either match or are clearly
   flagged for review.
3. Every item matches the menu exactly, package suffixes are preserved,
   quantities are numeric, and note/sendNote are attached to the right item or
   order.
4. Additions, revisions, cancellations, resends, and group timestamps are
   correct.
5. Limited-stock allocation never exceeds stock and every decision has evidence.
6. The CSV has exactly 9 columns and can be read with the `csv` module.
7. For appends, no old row disappeared and the row-count increase equals the
   planned addition.

If one conflict is still unresolved, stop writing and use `[PERLU REVIEW]` or
ask the user. A wrong address is worse than holding one order for review.
