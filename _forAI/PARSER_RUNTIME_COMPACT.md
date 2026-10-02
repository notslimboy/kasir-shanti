# Compact Runtime: WhatsApp Order Parser

Use this file during routine parsing. `instruksi_ai_parser.md` remains the full
business-rule source of truth when a case is not covered here.

## One-Prompt Input

The user only needs to provide:

```text
pake instruksi_ai_parser.md cek dari 25 Jul jam 19:00 s/d 26 Jul jam 12 siang

menu hari ini
- Nama Menu - 35000
- Menu Terbatas - 5000 - stok 15
```

Extract the exact start/end date-time and menu from that prompt. Do not ask the
user to prepare files, commands, aliases, or context packs.

## Mandatory Preparation

Use a script-first pipeline to minimize model tokens: deterministic range
filtering, merging, deduplication, customer lookup, and candidate extraction
belong to Python. Never load complete `Chat1.txt` or `Chat2.txt` into the model
context.

1. Run `scripts/prepare_order_parse_context.py` with the exact inclusive range,
   every menu row, `Chat1.txt`, and `Chat2.txt`. It reads the existing local
   `customers.csv` snapshot immediately and must not contact Supabase.
2. Start with `review.md`, `hasil-parser.csv`, and `customer-terdeteksi.csv`;
   read `catatan-susulan.csv` and `stok-terbatas.csv` only when present. The
   customer list has one row per sender with item candidates, including the
   strict identity match, ongkir, alias evidence, and review status.
3. Verify suggestions against the filtered `chat-range.txt`; it contains every
   merged message in scope. Start from evidence references and inspect broader
   filtered context only when needed. Never fall back to loading either raw chat
   export into model context, and never parse only keyword-selected messages.
4. Read `menu.csv` and `run.json`. Canonical names, aliases, tags, and ongkir
   come from the local `customers.csv` snapshot. Use a selective lookup only when
   `hasil-parser.csv` cannot resolve an identity safely.
5. Refresh customer data separately with `update_customers_csv.py` only during
   scheduled maintenance or when the user explicitly requests it. Never put a
   network refresh in the normal parsing path.
6. Never treat candidate output as final orders. Preparation may refresh only
   `orderan/hasil-parser/<date range>/`; it must never edit a final order CSV.

## Fixed Three-Stage Flow

1. **Python preparation stage:** merge/deduplicate both chat exports, filter the
   exact inclusive range, detect menu/quantity candidates, group evidence by
   sender, and suggest safe follow-up modifier links. Ambiguous links stay
   unresolved; Python never emits a final order draft.
2. **AI interpretation stage:** read every filtered message; merge additions,
   revisions, cancellations, delivery/payment context, exact customer/ongkir,
   and limited-stock outcomes into clean order groups.
3. **AI CSV stage:** only after QA, write/return the final 9-column CSV in the
   user-requested mode (`code block`, new file, or append). Never replace unless
   replacement was explicit.

## AI Interpretation

- Combine both chat exports chronologically. Deduplicate identical exported
  messages, but preserve later additions, corrections, cancellations, delivery
  notes, and payment confirmations.
- Exclude sender `Shanti Catering`/`Santi Catering` from customer and order-item
  scanning. Keep its textual messages only as store announcements,
  confirmations, corrections, and stock evidence.
- Group messages only when sender/customer evidence proves they belong to the
  same order. A later addition changes the group's accepted timestamp to the
  latest accepted order message.
- Map items exactly to the user-supplied menu. Preserve package suffixes such as
  `/ 3`; they are part of the item name, not quantity.
- Resolve customer and ongkir only when address/name/number evidence agrees.
  Ambiguous or conflicting identities are `[PERLU REVIEW]`, never guessed.
- Treat addresses as unique identities. Accept only an exact sender alias/name
  or an exact complete address phrase. Never infer a customer from one shared
  number or partially overlapping address words.
- A short standalone follow-up modifier from the same sender (for example
  `tidak pedas`, `kuah banyak`, or `paha`) belongs to the most recent
  semantically compatible item in that order, not automatically to every item.
  Prefer an item already carrying related modifiers. If two items are equally
  plausible, hold the note for review instead of guessing.
- Final rows have exactly:
  `customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote`.

## Limited Stock and Menu Additions

- A limited base-menu item is available from the requested range start unless
  chat evidence says otherwise.
- A menu announced during the range becomes available at the exact timestamp of
  the official Shanti/Santi Catering announcement. Requests before that time do
  not enter its allocation queue.
- Search the full filtered chat after the announcement for requests from every
  source. A later addition is a separate request event at its actual time.
- Resolve edits, cancellations, explicit seller confirmations, and stock-out
  messages before allocation. If edit chronology is unavailable, hold it for
  review instead of inventing a position.
- Write `stock_events.csv` with:
  `item,availableFrom,stock,source`.
- Write `stock_requests.csv` with:
  `customer,requestTime,item,requestedQty,note,source`.
- Run `scripts/allocate_limited_stock.py`. Allocation is chronological FIFO with
  stable source order. If only 2 remain and a customer requests 5, allocate 2:
  outcome `DAPAT_SEBAGIAN`. The next request receives 0.
- Use `allocatedQty` in the final order CSV. Exclude zero-allocation item rows,
  but report every winner, partial winner, rejected requester, allocated total,
  and remaining stock.
- Explicit seller evidence about who received stock overrides a purely inferred
  queue. Record the reason and source; never silently rewrite history.

## Final QA

- Both chat files were included and the range is exact and inclusive.
- Every filtered message was reviewed; no keyword-only omission.
- No order outside the range, duplicate order, wrong address, invented time, or
  menu mismatch.
- Additions/corrections are merged once and groups sort ascending by their latest
  accepted timestamp.
- Limited allocation never exceeds stock and partial allocation is preserved.
- `append` preserves all existing rows; `new CSV` creates a new file; replacement
  requires the word `replace`/`overwrite` explicitly.
- If certainty is not supported by evidence, stop and ask the user.
