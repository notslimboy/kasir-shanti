# Output Contract

## Minimum Input

The recognizer receives:

- Today's menu, including official item names and prices when available.
- The user-bounded order sources: WhatsApp text, screenshots, or chat files that
  were explicitly requested.
- A time range when orders need filtering.
- Specific stock information when it exists.

Use `instruksi_ai_parser.md` for parsing rules and `customers.csv` for customer,
alias, tag, and shipping mapping. The customer snapshot is used directly; never
run a network sync as part of routine parsing.

## CSV Schema

| Column | Content |
| --- | --- |
| `customer` | Official/safe customer name including address, per the mapping rules. |
| `chatDate` | Chat timestamp: `dd/mm/yyyy HH.MM.SS`. |
| `payment` | Empty by default. |
| `ongkir` | Rupiah number without `Rp` and without dots. |
| `item` | Official menu name, exactly the same as today's menu. |
| `quantity` | Numeric order/portion count. |
| `harga` | Custom price only when it exists; empty for a normal menu price. |
| `note` | Kitchen note that applies only to the item on that row. |
| `sendNote` | Delivery/pickup instruction that applies to the whole customer order. |

Values stay Indonesian and verbatim; only the surrounding explanation is
English.

## Validation Before Sending

1. The header appears once and in exactly the contract order.
2. All orders fall inside the requested time range.
3. Matched items use the exact casing and spelling of today's menu.
4. No address or courier wording is left in `note`.
5. No kitchen instruction leaks into `sendNote`.
6. If the same item has different notes, each variation has its own row.
7. There is no duplicate order from a resend without an addition.
8. Order groups run oldest to newest; empty timestamps go last and are reported
   in the review.
9. With limited stock, unfulfilled items are not added to the CSV and are listed
   in a separate report when requested.

## CSV Escaping

Use an empty value for missing data. If a value contains a comma, a quote, or a
newline, quote it using standard CSV format. For `note` and `sendNote`, prefer
normalizing commas into semicolons per the main instructions.
