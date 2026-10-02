# For AI Agents

Start with:

- `PROJECT_TECHNICAL_CONTEXT.md`
- `wa_chat_parser_instruction.md` for WhatsApp/order CSV work.
- `ORDER_PARSING_GUARDRAILS.md` for the required preflight, audit, stock, file-write, and QA protocol.
- `PARSER_RUNTIME_COMPACT.md` for the normal one-prompt, token-saving parsing workflow.

For a WhatsApp parser task, `../instruksi_ai_parser.md` remains the business-rule source of truth. Do not create, append, sort, replace, or otherwise edit an order CSV until the guardrail checklist has been completed.

For a Chat1.txt + Chat2.txt range, run `../scripts/prepare_order_parse_context.py`. It refreshes `../orderan/hasil-parser/<date range>/` with a lossless exact-range evidence bundle, sender-grouped review packets, conservative item/note candidates, and `customer-terdeteksi.csv` for strict per-sender identity/ongkir audit; final order CSVs remain untouched. The fixed flow is: Python filters and structures both chats -> AI verifies and cleans every candidate against the filtered evidence -> AI writes the final CSV after QA. For limited stock, create reviewed event/request CSVs and run `../scripts/allocate_limited_stock.py` so FIFO and partial allocation are deterministic.

That file contains the full English technical handoff for Kasir Shanti Catering: project purpose, workflows, frontend state, SQLite schema, APIs, Google Sheets sync, receipt printing, bulk CSV order import, A4 report printing, dashboard behavior, known limitations, and development guidelines.

Latest covered changes: 2026-06-16.
