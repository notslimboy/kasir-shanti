#!/usr/bin/env python3
"""Allocate limited menu stock by timestamp FIFO with partial fulfillment."""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass
class StockEvent:
    item: str
    available_from: datetime
    stock: float
    source: str


@dataclass
class Request:
    index: int
    customer: str
    request_time: datetime
    item: str
    requested: float
    note: str
    source: str


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def parse_timestamp(value: str) -> datetime:
    clean = str(value or "").strip().replace(".", ":")
    for date_format in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        for time_format in ("%H:%M:%S", "%H:%M"):
            try:
                return datetime.strptime(clean, f"{date_format} {time_format}")
            except ValueError:
                pass
    raise ValueError(f"timestamp tidak valid: {value!r}")


def parse_quantity(value: str, label: str) -> float:
    try:
        number = float(str(value or "").strip().replace(",", "."))
    except ValueError as error:
        raise ValueError(f"{label} bukan angka: {value!r}") from error
    if number <= 0:
        raise ValueError(f"{label} harus lebih dari 0: {value!r}")
    return number


def format_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else ("%.3f" % value).rstrip("0").rstrip(".")


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        raise ValueError(f"file tidak ditemukan: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        return list(reader.fieldnames or []), [{key: value or "" for key, value in row.items()} for row in reader]


def require_header(actual: list[str], expected: list[str], path: Path) -> None:
    missing = [name for name in expected if name not in actual]
    if missing:
        raise ValueError(f"kolom {', '.join(missing)} tidak ada di {path}")


def load_events(path: Path) -> dict[str, StockEvent]:
    header, rows = read_csv(path)
    require_header(header, ["item", "availableFrom", "stock", "source"], path)
    events: dict[str, StockEvent] = {}
    for line_number, row in enumerate(rows, start=2):
        item = row["item"].strip()
        key = normalize_key(item)
        if not key:
            raise ValueError(f"item kosong di {path}:{line_number}")
        if key in events:
            raise ValueError(f"event stok duplikat untuk {item!r}; gabungkan menjadi satu stok awal")
        events[key] = StockEvent(
            item=item,
            available_from=parse_timestamp(row["availableFrom"]),
            stock=parse_quantity(row["stock"], f"stock {item}"),
            source=row["source"].strip(),
        )
    if not events:
        raise ValueError("stock_events.csv kosong")
    return events


def load_requests(path: Path, events: dict[str, StockEvent]) -> list[Request]:
    header, rows = read_csv(path)
    require_header(header, ["customer", "requestTime", "item", "requestedQty", "note", "source"], path)
    requests: list[Request] = []
    for index, row in enumerate(rows):
        item = row["item"].strip()
        key = normalize_key(item)
        if key not in events:
            raise ValueError(f"item request tidak punya event stok exact: {item!r}")
        customer = row["customer"].strip()
        if not customer:
            raise ValueError(f"customer kosong di {path}:{index + 2}")
        requests.append(
            Request(
                index=index,
                customer=customer,
                request_time=parse_timestamp(row["requestTime"]),
                item=events[key].item,
                requested=parse_quantity(row["requestedQty"], f"requestedQty {customer}"),
                note=row["note"].strip(),
                source=row["source"].strip(),
            )
        )
    return requests


def write_csv(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FIFO limited-stock allocator with automatic partial allocation")
    parser.add_argument("--events", required=True, type=Path, help="CSV: item,availableFrom,stock,source")
    parser.add_argument("--requests", required=True, type=Path, help="CSV: customer,requestTime,item,requestedQty,note,source")
    parser.add_argument("--output-dir", required=True, type=Path, help="New or existing output directory")
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    try:
        events = load_events(args.events)
        requests = load_requests(args.requests, events)
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    remaining = {key: event.stock for key, event in events.items()}
    allocated_total = {key: 0.0 for key in events}
    unfulfilled_total = {key: 0.0 for key in events}
    result_rows: list[dict[str, str]] = []
    ordered_requests = sorted(requests, key=lambda request: (request.request_time, request.index))
    for request in ordered_requests:
        key = normalize_key(request.item)
        event = events[key]
        stock_before = remaining[key]
        if request.request_time < event.available_from:
            allocated = 0.0
            unfulfilled = request.requested
            outcome = "SEBELUM_MENU_DIUMUMKAN"
        else:
            allocated = min(request.requested, stock_before)
            unfulfilled = request.requested - allocated
            remaining[key] -= allocated
            if allocated == request.requested:
                outcome = "DAPAT"
            elif allocated > 0:
                outcome = "DAPAT_SEBAGIAN"
            else:
                outcome = "TIDAK_DAPAT"
        allocated_total[key] += allocated
        unfulfilled_total[key] += unfulfilled
        result_rows.append(
            {
                "item": event.item,
                "customer": request.customer,
                "requestTime": request.request_time.strftime("%d/%m/%Y %H.%M.%S"),
                "requestedQty": format_number(request.requested),
                "allocatedQty": format_number(allocated),
                "unfulfilledQty": format_number(unfulfilled),
                "stockBefore": format_number(stock_before),
                "stockAfter": format_number(remaining[key]),
                "outcome": outcome,
                "note": request.note,
                "source": request.source,
            }
        )

    allocation_header = [
        "item", "customer", "requestTime", "requestedQty", "allocatedQty", "unfulfilledQty",
        "stockBefore", "stockAfter", "outcome", "note", "source",
    ]
    write_csv(args.output_dir / "stock_allocation.csv", allocation_header, result_rows)
    summary_rows = []
    for key, event in sorted(events.items(), key=lambda pair: pair[1].item.casefold()):
        summary_rows.append(
            {
                "item": event.item,
                "availableFrom": event.available_from.strftime("%d/%m/%Y %H.%M.%S"),
                "initialStock": format_number(event.stock),
                "allocatedQty": format_number(allocated_total[key]),
                "unfulfilledQty": format_number(unfulfilled_total[key]),
                "remainingStock": format_number(remaining[key]),
            }
        )
    write_csv(
        args.output_dir / "stock_summary.csv",
        ["item", "availableFrom", "initialStock", "allocatedQty", "unfulfilledQty", "remainingStock"],
        summary_rows,
    )
    print(f"Requests: {len(requests)} | Items: {len(events)}")
    print(f"Allocation: {args.output_dir / 'stock_allocation.csv'}")
    print(f"Summary: {args.output_dir / 'stock_summary.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
