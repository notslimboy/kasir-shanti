#!/usr/bin/env python3
"""Turn an order CSV into one tidy, printable Excel report.

The order CSV is the import format (nine flat columns). Opening it in a
spreadsheet shows a wall of rows, which is unreadable for the kitchen and for
the owner checking a day's takings. This script renders the same rows as a
document instead:

  * a header band with the date range,
  * money summary (item subtotal, shipping, grand total),
  * the kitchen recap (KOT) per menu item,
  * one block per struk — customer, timestamp, shipping, delivery note,
    its items, and that struk's own subtotal.

Nothing is recalculated from memory: every number comes from the CSV rows and
the menu prices passed on the command line.

Usage:

    python3 scripts/buat_laporan_xlsx.py \\
        --csv "orderan/november/Order-tanggal 23 - 24 Nov 2026.csv" \\
        --out "orderan/november/Order-tanggal 23 - 24 Nov 2026.xlsx" \\
        --judul "Orderan 23-24 Nov" \\
        --periode "23 – 24 NOVEMBER 2026" \\
        --menu-line "Sayur Asem|15000" \\
        --menu-line "Lontong Balap|15000"

Menu prices can also come from a CSV with `nama,harga` columns via
`--menu-file`. Prices are what the report shows in the Harga and Subtotal
columns; a row-level `harga` in the order CSV is a custom price and does not
replace the menu price.
"""

from __future__ import annotations

import argparse
import collections
import csv
import math
import sys
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# Design tokens sampled from DESIGN.md so the report reads as part of the app.
FOREST = "032313"
FOREST_DEEP = "092C1B"
LIME = "AEDD33"
LIME_AREA = "D9F0A2"
MINT = "ECF3F1"
LINE = "EEF4DE"
MUTED = "5A6B5F"
INK = "1B2B22"

# Width in spreadsheet characters. The order header and the delivery note are
# merged across all five columns, so their text area is the sum of these.
LEBAR = (38, 8, 13, 14, 42)
LEBAR_GABUNG = sum(LEBAR)

KOLOM_CSV = [
    "customer",
    "chatDate",
    "payment",
    "ongkir",
    "item",
    "quantity",
    "harga",
    "note",
    "sendNote",
]


def baca_menu(lines: list[str], path: str | None) -> list[tuple[str, int]]:
    """Menu order matters: it is the tie-break when two items sell equally."""
    menu: list[tuple[str, int]] = []
    if path:
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                nama = (row.get("nama") or row.get("item") or "").strip()
                harga = (row.get("harga") or row.get("price") or "").strip()
                if not nama or not harga:
                    continue
                menu.append((nama, int(float(harga.replace("Rp", "").replace(".", "").replace(",", ".")))))
    for line in lines:
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 2:
            raise SystemExit(f"Format --menu-line salah: {line!r}. Contoh: 'Rawon|35000'")
        menu.append((parts[0], int(float(parts[1]))))
    if not menu:
        raise SystemExit("Menu kosong. Isi --menu-line atau --menu-file.")
    return menu


def baca_order(path: str) -> tuple[list[dict[str, str]], list[tuple[tuple[str, str, str], list[dict[str, str]]]]]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        hilang = [k for k in KOLOM_CSV if k not in (reader.fieldnames or [])]
        if hilang:
            raise SystemExit(f"Kolom CSV tidak lengkap, hilang: {', '.join(hilang)}")
        rows = list(reader)

    # Satu struk = satu customer + satu chatDate + satu ongkir, sama seperti
    # kunci pengelompokan di impor-pesanan.ts.
    grup: dict[tuple[str, str, str], list[dict[str, str]]] = collections.OrderedDict()
    for row in rows:
        grup.setdefault((row["customer"], row["chatDate"], row["ongkir"]), []).append(row)
    return rows, list(grup.items())


def tulis(args: argparse.Namespace) -> int:
    menu = baca_menu(args.menu_line, args.menu_file)
    harga = dict(menu)
    rows, grup = baca_order(args.csv)

    asing = sorted({r["item"] for r in rows} - set(harga))
    if asing:
        raise SystemExit(
            "Item di CSV tidak ada di menu, harganya tidak bisa ditampilkan: "
            + ", ".join(asing)
        )

    wb = Workbook()
    ws = wb.active
    ws.title = (args.judul or Path(args.csv).stem)[:31]
    ws.sheet_view.showGridLines = False
    for i, w in enumerate(LEBAR, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    f_judul = Font(size=18, bold=True, color="FFFFFF")
    f_sub = Font(size=11, bold=True, color=FOREST_DEEP)
    f_meta = Font(size=9, italic=True, color=MUTED)
    f_hdr = Font(size=10, bold=True, color="FFFFFF")
    f_blok = Font(size=10, bold=True, color=FOREST_DEEP)
    f_item = Font(size=10, color=INK)
    f_kecil = Font(size=9, italic=True, color=MUTED)
    f_bold = Font(size=10, bold=True, color=INK)
    f_total = Font(size=11, bold=True, color=FOREST_DEEP)

    fill_forest = PatternFill("solid", fgColor=FOREST)
    fill_deep = PatternFill("solid", fgColor=FOREST_DEEP)
    fill_lime = PatternFill("solid", fgColor=LIME)
    fill_mint = PatternFill("solid", fgColor=MINT)
    fill_total = PatternFill("solid", fgColor=LIME_AREA)
    bawah = Border(bottom=Side(style="thin", color=LINE))
    bawah_tebal = Border(bottom=Side(style="medium", color=LIME))

    state = {"baris": 1}

    def merge(row: int, c1: int, c2: int) -> None:
        ws.merge_cells(start_row=row, start_column=c1, end_row=row, end_column=c2)

    def pita(teks: str, font: Font, fill: PatternFill | None, tinggi: int) -> None:
        row = state["baris"]
        merge(row, 1, 5)
        cell = ws.cell(row, 1, teks)
        cell.font = font
        if fill is not None:
            cell.fill = fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[row].height = tinggi
        state["baris"] += 1

    def kepala_tabel(kolom: list[str]) -> None:
        row = state["baris"]
        for j, judul in enumerate(kolom, 1):
            cell = ws.cell(row, j, judul)
            cell.font = f_hdr
            cell.fill = fill_deep
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = bawah
        ws.row_dimensions[row].height = 18
        state["baris"] += 1

    def angka(row: int, kolom: int, nilai, tebal: bool = False) -> None:
        cell = ws.cell(row, kolom, nilai)
        cell.number_format = "#,##0"
        cell.alignment = Alignment(horizontal="right")
        cell.font = f_bold if tebal else f_item

    # ── kop ────────────────────────────────────────────────────────────
    pita(args.toko, f_judul, fill_forest, 38)
    pita(args.judul_laporan, f_sub, fill_lime, 24)
    pita(args.catatan_kaki, f_meta, None, 16)

    # ── ringkasan uang ─────────────────────────────────────────────────
    subtotal = sum(int(float(r["quantity"])) * harga[r["item"]] for r in rows)
    ongkir = sum(int(kunci[2]) for kunci, _ in grup)

    def uang(label: str, nilai: int, tebal: bool = False, isi: PatternFill | None = None) -> None:
        nonlocal state
        row = state["baris"]
        merge(row, 1, 3)
        cell = ws.cell(row, 1, label)
        cell.alignment = Alignment(horizontal="right")
        cell.font = f_bold if tebal else f_item
        angka(row, 4, nilai, tebal)
        if isi is not None:
            for j in range(1, 5):
                ws.cell(row, j).fill = isi
        state["baris"] += 1

    uang("Subtotal item", subtotal)
    uang("Ongkir", ongkir)
    uang("GRAND TOTAL", subtotal + ongkir, tebal=True, isi=fill_total)
    state["baris"] += 1

    # ── rekap dapur ────────────────────────────────────────────────────
    pita("REKAP DAPUR (KOT)", f_hdr, fill_forest, 20)
    kepala_tabel(["Menu", "Porsi", "Harga", "Subtotal", "Struk"])

    rekap = []
    for urutan, (nama, satuan) in enumerate(menu):
        pilih = [r for r in rows if r["item"] == nama]
        if not pilih:
            continue
        porsi = sum(float(r["quantity"]) for r in pilih)
        struk = len({(r["customer"], r["chatDate"]) for r in pilih})
        rekap.append((nama, porsi, struk, satuan, int(porsi * satuan), urutan))
    # Porsi terbanyak dulu; kalau sama, ikut urutan menu hari ini.
    rekap.sort(key=lambda x: (-x[1], x[5]))

    for nama, porsi, struk, satuan, sub, _ in rekap:
        row = state["baris"]
        ws.cell(row, 1, nama).font = f_item
        cell = ws.cell(row, 2, int(porsi))
        cell.alignment = Alignment(horizontal="center")
        cell.font = f_item
        angka(row, 3, satuan)
        angka(row, 4, sub)
        cell = ws.cell(row, 5, f"{struk} struk")
        cell.font = f_kecil
        cell.alignment = Alignment(horizontal="left", indent=1)
        for j in range(1, 6):
            ws.cell(row, j).border = bawah
        state["baris"] += 1

    row = state["baris"]
    ws.cell(row, 1, "TOTAL").font = f_total
    cell = ws.cell(row, 2, int(sum(p for _, p, _, _, _, _ in rekap)))
    cell.font = f_total
    cell.alignment = Alignment(horizontal="center")
    angka(row, 3, "")
    angka(row, 4, sum(s for _, _, _, _, s, _ in rekap), tebal=True)
    for j in range(1, 6):
        ws.cell(row, j).fill = fill_total
        ws.cell(row, j).border = bawah_tebal
    state["baris"] += 2

    # ── rincian per struk ──────────────────────────────────────────────
    pita("RINCIAN PER STRUK", f_hdr, fill_forest, 20)
    kepala_tabel(["Menu", "Porsi", "Harga", "Subtotal", "Catatan"])

    for nomor, ((customer, tanggal, ong), items) in enumerate(grup, 1):
        row = state["baris"]
        merge(row, 1, 5)
        teks = f"{nomor}.   {customer}      ·      {tanggal}      ·      ongkir Rp {int(ong):,}"
        cell = ws.cell(row, 1, teks.replace(",", "."))
        cell.font = f_blok
        cell.fill = fill_mint
        cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[row].height = 19
        state["baris"] += 1

        kirim = next((i["sendNote"] for i in items if i["sendNote"].strip()), "")
        if kirim:
            row = state["baris"]
            merge(row, 1, 5)
            cell = ws.cell(row, 1, f"Kirim:   {kirim}")
            cell.font = f_kecil
            cell.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True, indent=1)
            # Teksnya membentang selebar lima kolom, bukan satu kolom.
            ws.row_dimensions[row].height = max(16, 13 * math.ceil(len(cell.value) / LEBAR_GABUNG) + 2)
            state["baris"] += 1

        subtotal_struk = 0
        for it in items:
            row = state["baris"]
            qty = int(float(it["quantity"]))
            satuan = harga[it["item"]]
            baris_total = qty * satuan
            subtotal_struk += baris_total
            ws.cell(row, 1, it["item"]).font = f_item
            cell = ws.cell(row, 2, qty)
            cell.alignment = Alignment(horizontal="center")
            cell.font = f_item
            angka(row, 3, satuan)
            angka(row, 4, baris_total)
            if it["note"].strip():
                cell = ws.cell(row, 5, it["note"])
                cell.font = f_kecil
                cell.alignment = Alignment(vertical="top", wrap_text=True, indent=1)
            for j in range(1, 6):
                ws.cell(row, j).border = bawah
            state["baris"] += 1

        row = state["baris"]
        # Label ini lebih panjang dari lebar kolom C, sementara kolom D di
        # baris yang sama berisi angka — tanpa merge, labelnya terpotong.
        merge(row, 1, 3)
        cell = ws.cell(row, 1, "Subtotal struk")
        cell.font = f_kecil
        cell.alignment = Alignment(horizontal="right")
        angka(row, 4, subtotal_struk, tebal=True)
        if int(ong):
            cell = ws.cell(row, 5, f"+ ongkir Rp {int(ong):,}")
            cell.font = f_kecil
            cell.alignment = Alignment(horizontal="left", indent=1)
        for j in range(1, 6):
            ws.cell(row, j).border = bawah
        state["baris"] += 1

    akhir = state["baris"] - 1
    ws.print_area = f"A1:E{akhir}"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    wb.save(args.out)

    print(f"tersimpan: {args.out}")
    print(f"  struk      : {len(grup)}")
    print(f"  baris item : {len(rows)}")
    print(f"  porsi      : {int(sum(float(r['quantity']) for r in rows))}")
    print(f"  subtotal   : {subtotal:,}".replace(",", "."))
    print(f"  ongkir     : {ongkir:,}".replace(",", "."))
    print(f"  grand total: {subtotal + ongkir:,}".replace(",", "."))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Order CSV -> one tidy printable Excel report.")
    p.add_argument("--csv", required=True, help="CSV orderan (9 kolom)")
    p.add_argument("--out", required=True, help="File .xlsx hasil")
    p.add_argument("--menu-line", action="append", default=[], help="Nama|Harga, boleh diulang")
    p.add_argument("--menu-file", help="CSV dengan kolom nama,harga")
    p.add_argument("--judul", default="", help="Nama sheet (maks 31 karakter)")
    p.add_argument("--periode", default="", help="Teks periode, mis. '23 – 24 NOVEMBER 2026'")
    p.add_argument("--toko", default="SHANTI CATERING", help="Nama di kop")
    p.add_argument("--catatan-kaki", default="", help="Baris kecil di bawah judul")
    args = p.parse_args()

    args.judul_laporan = args.periode or args.judul
    if not args.catatan_kaki:
        args.catatan_kaki = f"dibuat {date.today().strftime('%d/%m/%Y')}"
    return tulis(args)


if __name__ == "__main__":
    sys.exit(main())
