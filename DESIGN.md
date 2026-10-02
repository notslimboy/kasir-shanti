# Design System — Kasir Shanti (Next)

Visual source of truth: [`design/reference.png`](design/reference.png)
Sampled directly from image pixels (not estimated), 29 Sep 2026.

> **Important:** the reference is a generic admin/e-commerce dashboard. It does
> **not** cover POS checkout, thermal receipts, offline mode, or Indonesian
> language. The sections below separate what carries over from what must be
> translated.

---

## 1. Palette

Every value below is sampled from image pixels.

| Token | Value | Role |
|---|---|---|
| `--forest` | `#032313` | Dark sidebar, icons |
| `--forest-deep` | `#092C1B` | Active KPI card, text on lime |
| `--forest-mid` | `#397968` | Middle donut segment, secondary lines |
| `--lime` | `#AEDD33` | **Primary accent** — active icons, donut segment |
| `--lime-soft` | `#BDE55D` | Soft lime chart line |
| `--lime-area` | `#D9F0A2` | Area fill under the chart line |
| `--lime-bar` | `#78A22B` | Active indicator in the sidebar |
| `--page` | `#F5FCE3` | Page background (pale lime cream) |
| `--surface` | `#FFFFFF` | Cards |
| `--mint` | `#ECF3F1` | Paid / success status pill |
| `--amber` | `#F3DBA2` | Pending / unpaid status pill |
| `--amber-ink` | `#B45309` | Text on amber (needs ≥4.5:1 contrast) |
| `--orange` | `~#F0A04B` | ⚠️ **verify by eye** — thin lines, hard to sample |

### Color Rules

- **One accent only: lime.** Dark green = structure, lime = action/emphasis.
- **Forest-deep is for exactly one thing:** the active/focused KPI card. Two dark
  cards means nothing stands out.
- **Lime is never a background for long text** — its contrast is too low. Lime is
  for icons, large numbers, lines, and active borders only.
- **Numbers are always tabular.** All rupiah amounts are right-aligned and
  column-aligned.

### Dark Mode

The reference has **no dark mode**. A POS used at night needs it. Reasonable
derivations:

| Token | Dark |
|---|---|
| `--page` | `#0A1510` |
| `--surface` | `#10201A` |
| `--forest` | `#061E12` |
| `--lime` | `#B8E84A` (raised so it stays readable on dark) |

---

## 2. Shapes

The reference is **very rounded** — that is its signature, do not shrink it.

| Token | Value | Used for |
|---|---|---|
| `--radius-card` | `24px` | KPI card, chart card, table card |
| `--radius-inner` | `16px` | Elements inside a card |
| `--radius-control` | `12px` | Buttons, inputs, tabs |
| `--radius-pill` | `999px` | Status pill, filter chip, avatar |
| `--radius-sheet` | `32px` | Sheet/modal |

**Shadows** — soft, large, never hard:
```
--shadow-card:  0 8px 24px -12px rgba(3, 35, 19, 0.14);
--shadow-pop:   0 16px 40px -16px rgba(3, 35, 19, 0.22);
--shadow-none:  none;
```

---

## 3. Layout

```
┌──────┬───────────────────────────────────────────────┐
│      │ Topbar: brand ⌄      search        [+] action   │
│ side │───────────────────────────────────────────────│
│ bar  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐   KPI row (4)      │
│      │ └────┘ └────┘ └────┘ └────┘                    │
│ 88px ├─────────────────────────────┬─────────────────┤
│      │                             │  Donut + legend │
│      │   Large chart (2/3)         │  (1/3)           │
│      │                             │                 │
│      ├─────────────────────────────┤  Card gauge     │
│      │   Table (full width)        │  (1/3)           │
│      └─────────────────────────────┴─────────────────┘
```

- **88px icon-only sidebar**, `--forest`, rounded on the right edge
- Active icon: lime + **4px lime bar on the left** (`--lime-bar`)
- Avatar at the sidebar bottom
- **Mobile breakpoint:** the sidebar becomes a bottom bar or drawer. On a POS, a
  390px-wide screen must be able to complete a transaction.

---

## 4. Components

### Sidebar
- Icons only, 20px, stroke 1.75
- Active item: lime icon + 4px left bar `--lime-bar` + bg `rgba(174,221,51,0.10)`
- Hover: 6% white bg

### Topbar
- Left: name + chevron (workspace dropdown)
- Middle: search pill, white bg, pill radius
- Right: icon button + primary action `+ Tambah` (lime bg, `#092C1B` text)

### KPI card
```
┌─────────────────────────┐
│ Total Sales      (icon) │   label: 13px, #5A6B5F
│ $564.00                 │   number: 30px, 700, tabular
│ [+15%] from last month  │   delta pill + text
└─────────────────────────┘
```
- **Active variant:** bg `--forest-deep`, white label, white number, lime delta
- Delta up: pill bg lime 18%, text forest-deep
- Delta down: pill bg red 14%, dark red text
- Icon: 40px circle, bg lime 18%, icon forest-deep

### Large chart
- Line chart, 2 series (revenue + transactions)
- 3px line, **no excessive smoothing**, area fill under the line at 1
- Y axis in compact format (`260M`, not `260.000.000`)
- Tooltip: white card, 12px radius, shadow-pop, small label + large tabular number
- **Hover: dashed crosshair + large dot** (as in the reference)

### Donut + legend
- Thick donut (~22px), 4px white gap between segments
- 4 colors: forest-deep → forest-mid → lime → orange
- Legend: 6px bullet + left-aligned label, percentage **right-aligned tabular**

### Gauge
- Half circle, track `#EEF4DE`, fill forest-deep
- Large number in the middle, small `%`

### Table
- Header: `#F5FCE3`, uppercase 11px, tracking 0.06em, `#5A6B5F`
- Rows: border-bottom `#EEF4DE`, 64px tall
- 20px checkbox, 6px radius, lime check
- Columns: # · Order ID · Product (+thumbnail) · Date · Price · Status · Actions
- **Price right-aligned, tabular**
- Status pill: `Lunas` mint bg, dark green text · `Belum lunas` amber bg, amber-ink text
- Actions: round icon buttons, hover bg lime 12%

---

## 5. Typography

The reference uses geometric/rounded sans. Recommendation:

- **UI / headings:** Plus Jakarta Sans (already used in the old app, already
  liked)
- **Numbers:** Azeret Mono tabular — or `tabular-nums` in Plus Jakarta Sans

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Display (KPI number) | 30px | 700 | −0.02em |
| Page H1 | 20px | 700 | −0.02em |
| Card title | 16px | 600 | −0.01em |
| Body | 14px | 500 | 0 |
| Label / column head | 11–13px | 600 | 0.02em (uppercase for headers) |
| Delta pill | 12px | 600 | 0 |

---

## 6. What Carries Over From The Reference

✅ KPI row structure · large chart + donut column · table with status pills
✅ Icon-only sidebar with lime active bar · forest+lime palette
✅ Large radii (16–24px) · soft shadows

## 7. What Must Be Translated (the reference has none of this)

| Reference (EN) | Cashier version (ID) |
|---|---|
| `$564.00` | `Rp 265.000` |
| Total Sales | Omset / Transaksi |
| Profit | ⚠️ **none** — catering does not track profit |
| Invoice | Struk |
| Total Visitor / Affiliate Program | **irrelevant** → replace with **Ongkir per Kurir** + **Metode Pembayaran** |
| "On Progress" / "Pending" | `Lunas` / `Belum Lunas` / `Terhapus` |
| "Add new product" | `+ Tambah Menu` |
| "Search here..." | `Cari menu, SKU, atau customer...` |
| "Recent Order" | `Struk Terbaru` |
| "View all" | `Lihat semua` |

The right-hand column is real UI copy and stays Indonesian verbatim.

### Completely absent from the reference — design from scratch
1. **POS checkout** — the main transaction screen. Priority #1.
2. **72mm thermal receipt** — a physical format; it must not follow card styling.
3. **Offline states** — loading, sync, error, retry.
4. **Variants / pricing** — pricing type (normal / per-unit / package / custom).
5. **Multi-tenant reality** — 1 store, 1 cashier, no workspace switcher.

---

## 8. Rule: No Native Browser Widgets

`<select>`, `<input type="date">`, and `<datalist>` open OS-owned UI. That UI
cannot be themed with tokens, it looks different on every platform, and its
dropdown is often clipped on a narrow cashier screen.

Every control is therefore built by hand in `src/components/ui/`:

| Need | Component | Notes |
|---|---|---|
| Single choice | `Select` | Motion open/close animation, type-to-filter, full keyboard support |
| Date range | `DateRangePicker` | from–until in one calendar, with presets |

`src/lib/native-controls.test.ts` scans `src/` and fails if those tags reappear.
If that test fails, the component is wrong — not the test.

---

## 9. Charts

Every chart must be animated, including across page changes. Because each page
unmounts on a route change, a new chart always remounts and its intro animation
replays — no extra state needed.

- `CHART_ANIM` / `CHART_ANIM_FAST` from `src/components/chart-motion.ts` are
  spread onto `<Area>`, `<Bar>`, `<Pie>`. Never write `isAnimationActive={false}`.
- `ChartBox` has two modes: `height={260}` for short charts, or `fill` for charts
  that must grow with the card (`<Card fillBody>`). Without `fill`, a card in a
  grid leaves empty space below the chart.

Charts cannot be verified with `--screenshot --virtual-time-budget`: virtual time
skips timers but produces no frames, so animations stall and the chart looks
empty. Use a real browser.

---

## 10. Ground Rules

1. **One accent: lime.** If a second color is needed, first ask whether it
   carries meaning.
2. **Forest-deep for one card only** per screen.
3. **Rupiah is always tabular, always `Rp`**, never `$`.
4. **UI copy in Indonesian.** An English string on screen is a bug.
5. **Never truncate labels** — button text never degrades to `Kelola`.
6. **Numbers never follow convention** — amounts must align in the column.
7. **Large radii are the signature.** 24px cards, not 8px.
8. **No fake numbers** — everything comes from Supabase or is marked as dummy.
9. **Every cashier action gets feedback.** Adding to the cart must be visible —
   without it the cashier cannot trust that the tapped item went in.

---

## 11. Undecided

- [ ] Display font: Plus Jakarta Sans or another, rounder geometric face?
- [ ] Dark mode: needed? (yes, if the POS is used at night)
- [ ] Charts: Recharts or hand-rolled SVG?
- [ ] Mobile: bottom bar or drawer for the sidebar?
- [ ] The exact orange (needs an eye check against the image)

Build components only after those five are settled.
