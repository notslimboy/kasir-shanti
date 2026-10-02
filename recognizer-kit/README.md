# Shanti Catering Recognizer Kit

A portable package for moving the WhatsApp order parser behaviour to another
AI.

## Rule Sources

`../instruksi_ai_parser.md` is the business-rule source of truth and
`../customers.csv` is the structured snapshot for customer names, aliases, tags,
and shipping. Nothing in this folder replaces them; this folder only makes those
rules easier to apply and test with another model.

## How To Use It In Another AI

1. Give the contents of `SYSTEM_PROMPT.md` as the system instruction or opening
   instruction.
2. Give the complete `instruksi_ai_parser.md` in the same context.
3. Give today's menu, the time range, and only the order sources the user
   actually requested.
4. If the user supplied screenshots only, use screenshots only. Do not read chat
   files unless explicitly asked.
5. Request output with the exact CSV header, then compare against
   `fixtures/evaluation-cases.md` before using it on real orders.

## Package Contents

- `SYSTEM_PROMPT.md`: ready-to-paste instruction for the target AI.
- `OUTPUT_CONTRACT.md`: input, output, and validation contract.
- `fixtures/evaluation-cases.md`: short test cases for checking important
  behaviour.

## Quick Pass Criteria

- Exact CSV header: `customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote`.
- One row per item, with the shared order details repeated on every row of that
  order.
- `note` only for per-item kitchen needs; `sendNote` only for delivery, pickup,
  or courier instructions per customer.
- Customer and shipping follow the local `customers.csv` snapshot; a Supabase
  refresh is separate maintenance, not part of routine parsing.
- Orders run oldest to newest from the chat, with all rows of one order kept
  adjacent.
- Uncertain data must not be guessed; mark `[PERLU REVIEW]` per the main rules.
- Prose and reports in English; CSV values stay Indonesian and verbatim.
