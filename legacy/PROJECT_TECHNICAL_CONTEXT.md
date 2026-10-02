# Kasir Shanti Catering - Technical Context for AI Agents

Last updated: 2026-05-31

This document is written for future AI agents, engineers, and maintainers who need to understand, continue, regenerate, or safely modify the Kasir Shanti Catering cashier web app.

## 1. Project Purpose

Kasir Shanti Catering is a local-first cashier web application for a small Indonesian catering business. The owner needs a simple, fast, beginner-friendly cashier tool for employees who may not be technical.

The app is intended for daily food ordering and catering operations, especially menu-based sales in East Java. It supports household-style food menus, drinks, snacks, changing daily menus, receipt printing, and sales tracking.

Primary goals:

- Make checkout fast and clear for employees.
- Sync product/menu data from Google Sheets when the device has internet.
- Keep usable product data cached locally when offline.
- Save completed sales into a local SQL database.
- Print thermal receipts on common Indonesian online-shop POS thermal printers.
- Print A4 sales reports for the selected dashboard date/range.
- Import externally summarized WhatsApp group orders from CSV into editable draft orders.
- Support phone, tablet, and desktop screen sizes.
- Keep UI copy in Indonesian because the cashier/employees use Indonesian.
- Keep implementation simple enough for local use, not a full ERP.

Non-goals for the current version:

- Cloud multi-device transaction sync.
- User login or role-based access.
- Payment gateway integration.
- Automatic write-back from sales to Google Sheets.
- Multi-branch inventory reconciliation.
- A hosted stateless deployment such as Vercel while still using local SQLite.
- In-app AI or direct WhatsApp integration. AI summarization happens outside the app; the app only receives CSV output.

## 2. Current Technology Stack

The project is intentionally simple and dependency-light.

Frontend:

- `index.html` for app structure, dialogs/modals, and UI controls.
- `styles.css` for full responsive styling, dark/light theme, receipt print CSS, modal behavior, and layout.
- `script.js` for all frontend logic and state.
- SheetJS from CDN for `.xlsx` / `.xls` imports:
  - `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`

Backend:

- `server.py`
- Python standard library only.
- `ThreadingHTTPServer` for serving the static app and local API.
- SQLite via `sqlite3`.

Storage:

- Browser `localStorage` for the operational product cache, cart, held carts, app settings, Google Sheet sync settings, daily menu filters, import drafts, and last receipt.
- Local SQLite file `kasir-bento.sqlite3` for completed sales, sale line items, customer profiles, and a mirrored product inventory table.

PWA/offline shell:

- `manifest.webmanifest`
- `service-worker.js`
- App shell files are cached.
- API routes are not cached by the service worker.

## 3. Important Files

| Path | Purpose |
| --- | --- |
| `index.html` | Main app markup: cashier panels, inventory modal, receipt settings modal, receipt preview modal, bulk import modal, dashboard modal, sale detail modal, delete confirmation modal, held carts modal. |
| `styles.css` | Entire visual system: responsive bento layout, modal layout, dark/light theme, product cards, cart, dashboard, receipt paper, print CSS, toast placement, mobile mini cart. |
| `script.js` | Main application logic: state, localStorage persistence, product import, Google Sheet sync, cart, checkout, receipt generation, print flow, sales dashboard, daily menu, customer autocomplete, held carts, bulk order import, API calls. |
| `server.py` | Local Python backend, SQLite schema/migrations, sales CRUD API, product mirror API, soft delete/restore, customer profile API, backup/restore API. |
| `service-worker.js` | Static app shell caching. Cache name and asset query versions must be bumped when frontend assets change. |
| `manifest.webmanifest` | PWA metadata. App name is `Kasir Shanti Catering`. |
| `sample-items.csv` | Product/menu import sample. Current sample is Indonesian food/catering oriented. |
| `sample-bulk-orders.csv` | Bulk order import sample. |
| `logocatering.webp` | Shanti Catering logo used in app branding and receipt. |
| `drivers/XP PRINTER DRIVER.rar` | Thermal printer driver archive for the XP/POS-style receipt printer used by the cashier setup. Install this at the operating system level when setting up the cashier machine. |
| `docs/PROJECT_AGENTS.md` | Existing short role/handoff guide. This `_forAI` document is the deeper technical context. |

## 4. How to Run Locally

Run the backend:

```bash
python3 server.py
```

Default app URL:

```text
http://127.0.0.1:4174/
```

Health check:

```bash
curl http://127.0.0.1:4174/api/health
```

Optional port override:

```bash
python3 server.py 4175
```

The desktop wrapper prefers port `4174`; if it is unavailable, it searches `4175` through `4199`.

Default SQLite database:

```text
kasir-bento.sqlite3
```

The server binds to `127.0.0.1`, not `0.0.0.0`. If another device on the same network must open the app, the backend binding and local firewall/network setup need to be changed carefully.

## 5. Product and UX Context

The product is for a catering cashier workflow. It should feel operational, dense, and clear, not like a marketing website.

Design/UX principles already used:

- Indonesian labels for employee-facing copy.
- Large touch targets for tablet/phone use.
- Bento-style panels for beginner-friendly scanning.
- Main screen starts directly in the cashier workflow, not a landing page.
- Important actions are close to the work area.
- Desktop navigation/actions live in a left sidebar.
- Tablet and phone navigation uses a burger-triggered sidebar drawer.
- Toast notifications appear near the top center and disappear automatically.
- Modals lock background scrolling so only modal content scrolls.
- Cart checkout stays ergonomic on mobile.
- Dashboard is a modal, not a separate page.
- Product list hierarchy prioritizes price over stock badge.
- Dark/light theme toggle uses simple moon/sun icons.
- Dashboard controls should stay aligned with the `Dashboard Penjualan` heading and not float awkwardly above it.
- Transaction cards should show item lines as clear bullets/rows rather than comma-heavy prose.
- Shipping/ongkir should be visually called out in app UI with the delivery rider icon when shown outside the receipt.
- Date pickers for reports use the custom themed calendar, not the native browser date picker as the primary UI.
- Dates with transactions are marked with a small dot; empty selected dates are highlighted as an empty/error state.
- Receipt customer/address text is intentionally boxed, large, and extra bold for delivery clarity.

Keep future UI changes practical:

- Avoid decorative hero sections.
- Avoid nested cards inside cards.
- Avoid UI copy that explains the app too much inside the app itself.
- Keep all employee-facing wording short and Indonesian.
- Use Indonesian currency and date formatting where possible.

## 6. Frontend State Model

Primary state lives in `script.js` under `state`.

LocalStorage key:

```js
kasir-bento-state-v1
```

Important state sections:

| State key | Meaning |
| --- | --- |
| `products` | Inventory/menu product list cached in browser and mirrored into SQLite through `/api/products`. |
| `cart` | Active checkout cart. |
| `settings` | Store name, receipt settings, theme, print behavior. |
| `sale` | Current checkout metadata: shipping, tax, payment, customer, chat date, order source. |
| `sync` | Google Sheet URL, sheet name, auto-sync flag, last sync status. |
| `columns` | Spreadsheet column mapping. Defaults use Indonesian names. |
| `sales` | Sales loaded from SQLite API for dashboard. |
| `customers` | Customer profiles loaded from SQLite API. |
| `salesSummary` | Aggregate counts/revenue from backend. |
| `salesRange` | Dashboard range mode: `day`, `week`, `all`, or `custom`. |
| `salesStartDate` / `salesEndDate` | Active dashboard/report range boundaries. |
| `salesCalendar` | Custom sales calendar UI state: month, active field, hover date. |
| `dailyMenu` | Date-specific menu filter/import state. |
| `heldCarts` | Saved carts that can be resumed later. |
| `importDrafts` | Bulk imported order drafts. |
| `lastReceipt` | Last completed sale payload used for reprint/preview if cart is empty. |

Default settings include:

```js
storeName: "Kasir Shanti Catering"
receiptWidth: "58"
receiptFontSize: "medium"
autoPrint: true
printFlow: "direct"
receiptMode: "compact"
theme: "light"
```

State migration notes:

- Old store name `Kasir Bento` is migrated to `Kasir Shanti Catering`.
- Old receipt width defaults are moved to 58mm for thermal printer compatibility.
- Old payment label `Cash` is normalized to `Tunai`.
- Old English column names such as `name`, `price`, and `stock` are normalized to `nama`, `harga`, and `stok`.

## 7. Data Storage Responsibilities

The app deliberately uses browser state for fast cashier interactions and SQLite for durable local records.

Browser `localStorage` stores:

- Product inventory/menu data as the active UI cache.
- Google Sheet sync settings and last sync metadata.
- Current cart.
- Held carts.
- Receipt settings.
- Theme.
- Daily menu filter and batch imported menu for a specific date.
- Bulk order import drafts.
- Last receipt payload.

SQLite stores:

- Completed sales.
- Sale items.
- Customer profiles and default shipping history.
- Mirrored product inventory/menu data.
- Soft-delete metadata.

Important implication:

The frontend still treats `localStorage` as the immediate source for rendering and offline use, then mirrors product changes into SQLite. Use `Backup Semua` / `Restore Semua` for a full app backup because it includes both browser state and the SQLite database. The raw SQLite backup only backs up database rows.

## 8. SQLite Database Schema

The database is initialized and migrated in `server.py` by `init_database()`.

Database path:

```text
kasir-bento.sqlite3
```

Tables:

### `sales`

Purpose: transaction header.

Important columns:

| Column | Meaning |
| --- | --- |
| `id` | Primary key. |
| `receipt_no` | Unique receipt number generated by backend. |
| `completed_at` | Completion timestamp from frontend payload. |
| `store_name` | Store name at transaction time. |
| `payment` | Payment method, e.g. `Tunai`, `Transfer`, `QRIS`. |
| `subtotal` | Item subtotal. |
| `discount` | Historically used as shipping/ongkir for compatibility. |
| `tax` | Tax amount in Rupiah, not rate. |
| `total` | Subtotal + shipping + tax. |
| `customer_name` | Customer name/address. App treats this as the primary customer field. |
| `customer_address` | Currently kept mostly empty for compatibility. |
| `order_note` | Reserved. |
| `due_text` | Reserved. |
| `chat_date` | WhatsApp/order chat date if imported or manually filled. |
| `deleted_at` | Empty string if active, timestamp if soft-deleted. |
| `stock_restored_on_delete` | `1` if local stock was restored when deleted. |

### `sale_items`

Purpose: transaction line items.

Important columns:

| Column | Meaning |
| --- | --- |
| `sale_id` | Foreign key to `sales.id`. |
| `sku` | SKU copied from product at sale time. |
| `name` | Item name copied at sale time. |
| `price` | Unit price. |
| `quantity` | Quantity sold. |
| `line_total` | Price * quantity. |
| `note` | Item note, e.g. special request. |

### `products`

Purpose: durable local mirror of the inventory/menu list.

Important columns:

| Column | Meaning |
| --- | --- |
| `client_id` | Frontend product id. Unique. |
| `sku` | Product SKU when available. |
| `name` | Product/menu name. |
| `price` | Unit price in Rupiah. |
| `stock` | Numeric stock. |
| `stock_unlimited` | `1` if stock is unlimited. |
| `category` | Product category/filter label. |
| `aliases` | JSON array of alternative item names. |
| `source` | Product source, e.g. `manual`, `file`, `google`, or `demo`. |
| `updated_at` | Last product mirror update timestamp. |

### `customers`

Purpose: lightweight customer profile and shipping autocomplete.

Important columns:

| Column | Meaning |
| --- | --- |
| `name` | Unique customer/customer-address string. |
| `default_shipping` | Latest default shipping/ongkir. |
| `last_order_at` | Latest order timestamp, used for suggestion priority. |
| `created_at` | Creation timestamp. |
| `updated_at` | Update timestamp. |

Customer rows are upserted whenever a sale is created or edited. If a newer order comes in, the default shipping is updated.

## 9. Backend API

The local API is implemented in `server.py`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Returns server health and database filename. |
| `GET` | `/api/customers?limit=300&q=...` | Lists customer suggestions and default shipping values. |
| `GET` | `/api/sales?limit=50` | Lists active sales, newest first. |
| `GET` | `/api/sales?limit=50&includeDeleted=1` | Lists active and soft-deleted sales. |
| `POST` | `/api/sales` | Creates a completed sale and sale items. |
| `PUT` | `/api/sales/{id}` | Edits sale metadata and, when `items` is provided, replaces sale line items and recalculates subtotal/total. |
| `DELETE` | `/api/sales/{id}` | Soft-deletes a sale. Optional JSON body: `{ "restoreStock": true }`. |
| `POST` | `/api/sales/{id}/restore` | Restores a soft-deleted sale. |
| `GET` | `/api/products` | Lists mirrored products from SQLite. |
| `PUT` | `/api/products` | Replaces mirrored products with the frontend product cache. |
| `DELETE` | `/api/products` | Clears the mirrored product table. |
| `GET` | `/api/backup/database` | Downloads SQLite backup. |
| `POST` | `/api/backup/restore` | Restores database from uploaded SQLite bytes. |

Receipt number generation:

- Backend creates receipt numbers in `next_receipt_number()`.
- Format: `SH-YYYYMMDD-0001`.
- Date key comes from payload `receiptDateKey` or `completedAt`.
- Creation uses `BEGIN IMMEDIATE` to reduce race risk while generating the next receipt number.

Backup/restore behavior:

- Restore validates SQLite integrity.
- Restore requires at least `sales` and `sale_items` tables.
- Existing DB is copied to `kasir-bento.before-restore.sqlite3` before replacement.
- `init_database()` runs after restore to apply any newer migrations.
- `Backup Semua` is a frontend JSON export containing browser `localStorage` state plus a base64 SQLite backup.
- `Restore Semua` restores the SQLite backup and browser state together.

## 10. Inventory and Google Sheets Workflow

Inventory/menu data is local-first, cached in the browser, and mirrored into SQLite when the backend is available.

Supported sources:

- Manual product form.
- CSV/TSV file.
- Excel file (`.xlsx` / `.xls`) via SheetJS CDN.
- Public Google Sheet URL.
- Published Google Sheet CSV URL.

Default spreadsheet columns:

```csv
sku,nama,harga,stok,kategori,alias
```

Column meanings:

| Column | Required | Meaning |
| --- | --- | --- |
| `sku` | No, but recommended | Unique item code. |
| `nama` | Yes | Product/menu name. |
| `harga` | Yes | Price in Rupiah. |
| `stok` | No | Numeric stock or unlimited marker. |
| `kategori` | No | Category/filter label. |
| `alias` | No | Alternative names for matching imported orders. |

Unlimited stock formats:

- `Unlimited`
- `∞`
- `bebas`
- `tanpa batas`
- `tidak terbatas`
- `tak batas`
- `infinite`

Google Sheet sync:

- Auto-sync interval: 5 minutes (`SYNC_INTERVAL_MS = 5 * 60 * 1000`).
- Sync only runs when `navigator.onLine` is true and a sheet URL exists.
- Google Sheet data replaces products with source `google`.
- Local/manual products remain unless they match incoming products.
- Google Sheet sync is one-way: Sheet to app.
- Sales do not write stock back to the Google Sheet.
- After imports, manual edits, checkout stock changes, delete/restore stock adjustments, and database restore, the frontend syncs the product list with `/api/products`.
- On startup, the frontend loads products from SQLite if available. If SQLite has no products but the browser cache has products, it seeds the SQL mirror.

Product Portion Variants (1/2 and Jumbo):

- Portions like `1/2` and `Jumbo` are represented as distinct products in the database with their own specific prices and stocks (e.g. parent `Oseng Tahu Tempe` at Rp15,000, variant `Oseng Tahu Tempe 1/2` at Rp10,000, and `Oseng Tahu Tempe Jumbo` at Rp25,000).
- Relational mapping is resolved dynamically via name prefix matching: `getParentProduct(product)` strips suffixes like ` 1/2`, `setengah`, `separuh`, or `jumbo` to identify the parent product, while `getAvailableVariants(parent)` filters the inventory list for items starting with the parent's name.
- Cart dropdown: If a product in the cart has multiple variants available, a select dropdown is rendered under the cart item. Changing the dropdown swaps the active variant and auto-updates the cart item notes (e.g., adding "separuh porsi" or "porsi jumbo").
- Virtual variants: If a parent product exists but its `1/2` portion does not exist in the database, a virtual variant product is created dynamically with a calculated price (rounded to 500 or 1000) and unlimited stock.

Kelola Menu (Menu Management) Dialog Panel:

- The main tab in the "Kelola Barang" (Inventory) modal is "Kelola Menu", which lists all parent products in a clean, scrollable card list.
- Under each parent product card, any available portion variants (like `1/2` or `Jumbo`) are listed as nested cards.
- Directly from this list, cashiers can click "Edit" on a parent product or any variant. This programmatically navigates to the manual input form (which is hidden from the main tab buttons), prepopulates the values, and lets them change prices or stock.
- Clicking "+ Tambah Menu" from the list navigates to the blank manual form. A "Kembali ke Daftar" button is always present in the form to return to the menu list.
- After saving or updating a product, the form resets and automatically navigates the user back to the "Kelola Menu" list.

Google Sheet URL handling:

- Normal Google Sheets URLs are converted to CSV export through `gviz/tq?tqx=out:csv`.
- Published `/pubhtml` links are converted to `/pub?output=csv`.
- Existing CSV output links can be used directly.
- Private sheets are not supported without OAuth, Apps Script, or a backend service.

Duplicate product identity:

- If `sku` exists, SKU is the identity.
- If no SKU exists, identity uses normalized item name plus price.
- This is important because menus may legitimately have the same name with different prices, e.g. `Pepes Tongkol - 16000` and `Pepes Tongkol - 20000`.

## 11. Daily Menu Workflow

The daily menu feature exists because catering menus change day to day. Employees should only see items available for the current day to avoid wrong input.

State:

```js
dailyMenu: {
  date,
  productIds,
  onlyToday,
  lastImportAt
}
```

User-facing behavior:

- `Semua Menu` shows all products.
- `Menu Hari Ini` filters the product list to selected daily menu items.
- `Atur Menu` opens the inventory modal daily menu tab.
- User can paste CSV or upload a file for today's menu.
- If a row matches an existing product, it selects that existing product.
- If a row is new, the product can be created from the pasted/imported menu row.
- Duplicate matching must respect SKU and price. Do not collapse same-name different-price products unless the identity is truly the same.

Important implementation detail:

- Same-name products without SKU should be differentiated by price.
- Imported daily menu rows should not randomly select the first matching name if multiple prices exist.

## 12. Checkout Workflow

Cart Item Identity and Segregation:
- Items in the cart are identified by a unique `cartItem.id` (generated via `makeId("cart-item")`), rather than `productId`.
- If the same product is added with different notes (e.g. `2x Siomay (tanpa pare)` and `1x Siomay (pake pare)`), they remain as separate lines in the cart list, backend database (`sale_items` rows), printed receipts, and A4 reports.
- If a product is added with an empty note, it is merged with any existing empty-note item of the same product in the cart.
- Actions (+, -, edit note, delete) target the individual cart item ID.
- Stock limits check the aggregate quantity of all matching product rows in the cart against the product's inventory stock.

Normal checkout flow:

1. Cashier finds products in the product list.
2. Cashier taps `+` to add products to cart.
3. Cashier adjusts quantity and optional item note.
4. Cashier enters customer name/address.
5. App may auto-fill ongkir based on customer history.
6. Cashier selects payment method.
7. Cashier can preview receipt.
8. Cashier clicks `Selesaikan Transaksi`.
9. Frontend validates cart and warnings.
10. Frontend sends payload to `POST /api/sales`.
11. Backend saves sale and returns receipt number.
12. Frontend stores `lastReceipt`, decrements local stock, clears cart, reloads dashboard data.
13. App prints directly or opens receipt preview, depending on settings.

Validation behavior:

- Blocking errors prevent sale completion.
- Warnings ask for attention but do not always block.
- Examples:
  - Empty cart: blocking error.
  - Missing product in cart: blocking error.
  - Quantity greater than stock: blocking error.
  - Empty customer: warning.
  - Ongkir Rp0: warning.

Held carts:

- A cart can be held with `Tahan`.
- Held carts are stored in localStorage.
- Held carts can be reopened from `Buka Hold`.
- Held carts are useful when a cashier needs to pause one order and handle another.

## 13. Customer and Shipping Workflow

Customer profiles are intentionally lightweight.

Sources:

- SQLite `customers` table.
- Active/completed sales.
- Bulk import drafts.
- Held carts.
- Last receipt.

Behavior:

- When user changes the customer field, suggestions update.
- Selecting or typing a known customer can apply default shipping immediately.
- If an existing customer has `default_shipping`, ongkir should update as soon as that customer is selected/changed, not only after manually editing the ongkir field.
- Editing a completed sale also upserts customer shipping history.

Current customer field design:

- The app primarily uses `customer_name` as a combined customer name/address string.
- `customer_address` exists in SQLite but is not the main UI field.

## 14. Receipt and Thermal Printer Workflow

Receipt printing is a core requirement.

Supported receipt widths:

- 58mm
- 80mm

Receipt modes:

- `compact`: minimal receipt for daily cashier thermal printing.
- `complete`: includes more store information and footer details.

Current receipt behavior:

- Compact receipt does not print the receipt number; it prioritizes customer/address, items, subtotal, ongkir when present, payment, and total.
- Complete receipt includes the grayscale Shanti logo, store name/address, and footer.
- The customer/address line uses `.receipt-customer`: boxed, centered, larger, and extra bold. Keep this prominent because the customer field is effectively the delivery address.
- Item notes print under the relevant item only. Do not move item-specific notes into a separate global receipt section.
- Ongkir still prints as plain text in the receipt. Delivery icons are only for app UI, not receipt paper.
- The receipt print page size is measured dynamically and written as a concrete `@page` rule through `dynamic-print-page-style`; avoid returning to nested CSS variables for print page size because Chrome/printer drivers may fallback to a tall sheet and create large blank top/bottom gaps.
- Receipt print padding is intentionally tight (`0.5mm` top padding) to reduce wasted thermal paper.

Receipt settings modal:

- Button label in UI: `Edit Struk`.
- Store name.
- Store address.
- Footer note.
- Receipt width.
- Font size.
- Auto print on/off.
- Print flow direct/preview.
- Receipt content mode compact/complete.
- Test print.

Printer setup modal:

- Button label in UI: `Setup Printer`.
- Shows the included XP printer driver archive.
- Links to `drivers/XP PRINTER DRIVER.rar`.
- Gives a short install/checklist flow for common XP/POS thermal printers.
- Includes a test print button using the current receipt print flow.

Print behavior:

- Receipt printing is executed by rendering the receipt HTML inside a hidden `iframe` (`.receipt-print-frame`) and calling `print()` on that iframe window to ensure styles (like `@page`) do not leak into the parent document.
- Browser printing is used through the iframe `print()` function.
- No native printer API is used.
- This means the OS/browser print dialog still controls the selected printer.
- Auto print means the app opens the print dialog after sale completion. It cannot silently print without user/browser/OS permission.

Thermal printer notes:

- The project includes the intended thermal printer driver archive at `drivers/XP PRINTER DRIVER.rar`.
- Use that XP printer driver when setting up the cashier machine's thermal receipt printer.
- Installing the driver is an OS-level setup step. The web app does not install drivers automatically.
- Common POS58/POS80 thermal printers from Indonesian marketplaces should work if drivers and paper sizes are correct.
- 58mm print CSS uses a narrower print width to avoid right-side clipping.
- Receipt page height is dynamically measured before printing.
- If multiple receipts are printed in a batch, they are separated by a dotted border (`border-top: 1px dashed #111`) and a small gap, using `page-break-inside: avoid` to print consecutively on a single roll of thermal paper.
- Long item names and multiple items should remain readable.
- A4 report printing uses a separate `report-print-mode` and iframe flow, so report `@page` settings should not leak into receipt printing.

Common printer setup:

- Install the included XP printer driver archive if this is the printer model used in the shop.
- Use POS58/POS80 driver if available and compatible.
- Paper width: 58mm or 80mm matching the setting.
- Margins: none/minimum.
- Scale: 100%, or slightly lower if right side clips.
- Disable browser headers/footers.

## 15. Sales Dashboard Workflow

The sales dashboard is a modal, not a separate route.

Capabilities:

- Load sales from SQLite.
- Date range filters:
  - `Harian`.
  - `Mingguan`.
  - `Semua`.
  - `Custom`.
- Date stepping:
  - Previous date.
  - Next date.
  - Today.
- Custom themed calendar:
  - Start/end date buttons replace native date inputs in the main UI.
  - Dates with transactions show a small dot.
  - Selected empty dates use an error/empty highlight and detail copy.
  - Calendar detail text shows small stats such as transaction count, total item, and revenue.
- Status tabs:
  - Active.
  - Deleted.
  - All.
- Summary cards:
  - Transactions in selected range.
  - Revenue in selected range.
  - Total active transactions.
- Daily closing card:
  - Payment method breakdown.
  - Item totals.
  - Average transaction amount.
  - Payment rows use supporting icons, such as `Rp` for cash/payment values.
- Search:
  - Receipt number.
  - Item name.
  - Customer.
  - Note.
  - Payment method.
- Per-sale actions:
  - `Cetak Struk`.
  - Edit.
  - Detail.
  - Delete.
  - Restore for deleted sales.
- A4 report print:
  - Button label: `Cetak Laporan A4`.
  - Prints the detail transaction report for the selected dashboard range/date, not a receipt.
  - Supports daily, weekly, all, and custom range based on current dashboard filters.
- CSV export:
  - `CSV Tanggal Ini` / `CSV Rentang`.
  - `CSV Semua`.
- Backup/restore SQLite.
- Full app backup/restore:
  - `Backup Semua` exports browser state plus SQLite into one JSON file.
  - `Restore Semua` restores both parts.
- Export actions are grouped inside an `Export` menu to keep the dashboard header clean.

Recent UX expectation:

- The search box should be near the transaction list, not far above the list.
- Transaction card actions should be responsive and not overflow in narrow modals/screens.
- Transaction item summaries should be easy to scan as separate lines/points.
- Ongkir in transaction cards should include the delivery rider icon.

## 16. Edit, Reprint, Delete, and Restore Sale

Users need to fix common cashier mistakes after a receipt was printed, such as forgotten ongkir.

Supported correction flow:

- Open dashboard.
- Open sale detail.
- Click edit.
- Change customer, payment, ongkir, pajak, chat date, and item lines.
- Add/remove sale items or edit item name, SKU, quantity, price, and note.
- Save.
- Reprint the receipt.

Stock behavior during edit:

- If edited items match existing products by SKU/name, the frontend reconciles the stock delta between the previous sale and the updated sale.
- Unlimited products are skipped.
- Ad-hoc items that do not match products still save to the receipt, but cannot adjust inventory automatically.

Soft delete:

- `DELETE /api/sales/{id}` does not permanently remove rows.
- It fills `deleted_at`.
- Deleted sales appear under the `Terhapus` tab.
- Users can restore with `POST /api/sales/{id}/restore`.

Stock behavior during delete:

- User may choose to restore local stock on delete.
- If restored sale had stock restored on delete, app decrements local stock again when restored.
- This affects the local product cache and the SQLite product mirror, not Google Sheet.

## 17. Bulk Order Import Workflow

The app can turn externally summarized WhatsApp-style orders into draft transactions. The app itself should not contain an AI model or direct WhatsApp integration. The intended workflow is:

1. User exports/copies WhatsApp group chat outside the app.
2. User uses external AI to summarize orders into the required CSV.
3. User imports/pastes the CSV into the app.
4. App creates editable draft orders.
5. User reviews and edits every draft.
6. User can open one draft into the cart, or process all ready drafts into completed transactions.
7. Ready drafts can also be processed and batch-printed.

Expected CSV format:

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
"Bu Ani - Jl Melati 12","28/05/2026 10.15.00","Tunai",10000,"Nasi Goreng Rumahan",20,,"sambal pisah untuk 5 porsi","antar ke satpam"
```

CSV rules:

- `customer` is the WhatsApp contact name and should be treated as the delivery address/customer identifier. Do not add a separate `address` field unless a future feature explicitly changes this model.
- Repeat `customer`, `chatDate`, `payment`, `ongkir`, and `sendNote` for every item row from the same customer. The parser can inherit repeated metadata when rows are grouped, but generated CSV should be explicit for admin readability.
- `harga` stays blank for current-menu items. Fill it only for an explicit custom/manual price.
- `note` belongs to the item row, e.g. `mie tidak pakai udang`, `bakso sambal pisah`, or `es cao kotak-kotak`.
- `sendNote` contains delivery/pickup/destination instructions, e.g. `antar ke satpam`, `ambil gojek`, or `kirim ke Direktorat ITS`.
- Use `ongkir` for shipping/delivery fee. Old `diskon` language should not be used for this workflow.
- Source CSV payment is blank unless it is explicitly confirmed by chat. The app may preselect `Tunai` while a draft is edited.
- Before a parser agent writes an order file, it must follow `_forAI/ORDER_PARSING_GUARDRAILS.md` and `../instruksi_ai_parser.md`.
- Imported item names are matched against products by SKU/name/alias and price context when available.
- If there are duplicate menu names or ambiguous item matches, the draft should show a warning/action instead of silently choosing the wrong product.

Input methods:

- Upload CSV/TSV file.
- Paste CSV-like text.
- Copy AI prompt from the app and use it externally to convert WhatsApp chat into CSV.

Draft behavior:

- Each customer can have multiple item rows.
- Drafts are stored in localStorage.
- Drafts can be loaded into the cart for manual review/checkout.
- Ready drafts can be processed in batch.
- Batch print exists for ready drafts.
- Draft status summarizes missing customer, missing items, duplicate/ambiguous menu matches, and ready count.
- `Proses Semua Siap` converts all ready drafts into completed transactions.
- The batch print action converts ready drafts and prepares the receipt batch.

AI prompt language:

- The built-in prompt is Indonesian because the user and source chats are Indonesian.
- It instructs AI to output CSV only, no markdown.
- It enforces strict case-sensitive and exact-text menu matching against today's menu ("Daftar Menu Hari Ini").
- It explicitly instructs the AI not to group items of the same product if they have different notes. They must be outputted as separate rows in the generated CSV.

## 18. Theme and Responsive Behavior

Theme:

- Light/dark toggle.
- Theme is stored in `state.settings.theme`.
- Root attribute: `:root[data-theme="dark"]`.
- UI uses CSS variables for colors.

Responsive behavior:

- Desktop uses a left sidebar for global actions and a two-panel bento layout for products and cart.
- Tablet/phone hides the sidebar behind a burger menu drawer.
- Mobile stacks panels.
- Product cards and sale cards use responsive grids.
- Checkout actions and dashboard actions wrap.
- Modal width uses viewport-aware `dvw` sizing.
- Background scrolling is locked while modal is open.

Important modal behavior:

- `html.modal-open` and `body.modal-open` prevent background scroll.
- Modal content itself should remain scrollable.
- Keep this behavior intact for any new modal.

## 19. Service Worker and Cache Busting

The service worker caches the static app shell:

- `./`
- `./index.html`
- `./styles.css?v=...`
- `./script.js?v=...`
- samples
- manifest
- icon/logo

It does not cache `/api/*`.

Current frontend cache version at this handoff: `v177`.

When changing frontend assets:

1. Update query strings in `index.html` for `styles.css?v=...` and `script.js?v=...`.
2. Update `CACHE_NAME` in `service-worker.js`.
3. Update cached asset query strings in `service-worker.js`.
4. Verify using a hard reload or new query URL such as `/?v=NN`.

Failure to bump cache may make the user see stale UI.

## 20. Known Limitations and Risks

Current limitations:

- Product inventory is mirrored to local SQLite, but this is not real multi-device conflict-safe sync.
- Google Sheet sync is one-way.
- WhatsApp/AI summarization is external; the app only imports CSV.
- No login or role tracking.
- No cashier/user audit trail.
- No cloud sync for multiple devices.
- No automatic stock write-back to Google Sheet.
- No native direct thermal printer API.
- Excel import requires CDN availability for SheetJS.
- Raw SQLite backup does not include browser-only UI state such as active cart, held carts, settings, and drafts. Use `Backup Semua` for that.

Risk areas:

- Do not hard-delete sales unless explicitly requested.
- Be careful changing receipt CSS because 58mm thermal printers clip easily.
- Be careful changing receipt print page sizing; dynamic concrete `@page` values are used to prevent large blank gaps.
- Be careful with Google Sheet matching; same-name different-price items are valid.
- Be careful with bulk order matching; duplicate menu names must show warnings/actions instead of silently selecting the wrong product.
- Be careful with localStorage migrations; existing user data should not be reset.
- Be careful with cache versions; stale UI has caused confusion.
- Be careful with Indonesian employee-facing labels; do not convert app UI to English.

## 21. Suggested Future Improvements

High-value improvements:

- Add explicit product availability by date in database instead of localStorage-only daily menu.
- Build on the SQLite product mirror if local-network multi-device inventory becomes a requirement.
- Improve customer management further with merge/review flows for similar customer-address strings.
- Add local network mode instructions for tablets/phones on the same Wi-Fi.
- Add duplicate product review screen with better visual comparison.
- Add a printer-specific troubleshooting page for common 58mm/80mm driver clipping issues.
- Add better printed A4 report variants, e.g. compact daily kitchen prep, finance recap, and stock-shopping list.
- Add a bulk import audit trail so imported CSV rows can be traced back to source chat/date.
- Add a test harness for:
  - cart math,
  - receipt totals,
  - stock decrement/restore,
  - Google Sheet row parsing,
  - duplicate product matching,
  - daily menu matching,
  - sales dashboard filtering.

Future larger architecture:

- If multi-device sync becomes required, use a real backend database and API.
- Options:
  - SQLite + local network server for one shop location.
  - PostgreSQL/MySQL with hosted backend for multiple devices/locations.
  - Supabase/Firebase if authentication and cloud sync become important.
- For private Google Sheets, add OAuth or Google Apps Script.
- For silent direct printing, investigate platform-specific solutions, e.g. WebUSB/WebSerial where supported or a small local print bridge. Browser `window.print()` alone cannot silently print.

## 22. Development Guidelines for Future AI Agents

Before editing:

- Read `README.md`, this file, and the relevant portions of `script.js`, `styles.css`, `server.py`, and `index.html`.
- Preserve existing user changes.
- Do not reset or delete SQLite/localStorage data unless explicitly requested.
- Keep edits scoped.

When changing frontend:

- Use existing CSS variables and layout patterns.
- Keep UI labels Indonesian.
- Test desktop and narrow mobile widths conceptually or with browser screenshots.
- Check that buttons do not overflow.
- Check that modal background scroll remains locked.
- Bump service worker cache and asset query versions.

When changing backend:

- Use SQLite migrations inside `init_database()`.
- Keep old columns compatible.
- Validate API payloads and return clear Indonesian error messages where user-facing.
- Do not permanently delete sales unless a new explicit archival/hard-delete feature is requested.

When changing receipts:

- Verify 58mm and 80mm behavior.
- Keep receipt text compact and bold enough for thermal printers.
- Measure page height before print.
- Avoid wide layouts that may clip on POS58.

When changing imports:

- Keep Indonesian default column names.
- Preserve aliases.
- Preserve same-name different-price matching.
- Keep price parsing robust for Indonesian money formats.

Recommended verification commands:

```bash
node --check script.js
python3 -m py_compile server.py
curl -I 'http://127.0.0.1:4174/?v=LATEST'
```

Also verify in the browser when UI changes:

- No console errors.
- No horizontal overflow.
- Main workflow still works.
- Modal scroll is isolated.
- Dashboard and product list remain readable.

## 23. Glossary

| Term | Meaning |
| --- | --- |
| `barang` | Product/menu item. |
| `keranjang` | Cart. |
| `ongkir` | Delivery/shipping fee. |
| `struk` | Receipt. |
| `selesaikan transaksi` | Complete sale. |
| `menu hari ini` | Daily menu filter for the selected date. |
| `hold` | Temporarily save a cart to resume later. |
| `soft delete` | Mark sale deleted using `deleted_at`, without removing rows. |
| `restore` | Reactivate a soft-deleted sale. |

## 24. One-Sentence Project Summary

Kasir Shanti Catering is a local-first Indonesian cashier web app for catering operations that imports menu data from Google Sheets, mirrors inventory into SQLite, completes sales into SQLite, prints thermal receipts, and provides a responsive sales dashboard for daily closing and receipt correction.
