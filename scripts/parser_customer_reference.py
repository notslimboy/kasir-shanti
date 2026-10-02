#!/usr/bin/env python3
"""Build the parser customer lookup from the synchronized customer snapshot.

``customers.csv`` is refreshed from Supabase and is the structured authority.
Legacy Markdown mappings are still accepted when present, but are optional.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
HEADER = ["id", "name", "default_shipping", "tag", "aliases"]
TABLE_HEADING = "## DATABASE CONTEXT: OFFICIAL CUSTOMERS & ONGKIR"


def normalize_key(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii").casefold()
    return re.sub(r"[^a-z0-9]+", "", text)


def normalize_display(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def unique_values(values: Iterable[str], excluded_key: str = "") -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        display = normalize_display(value)
        normalized = normalize_key(display)
        display_key = display.casefold()
        if not normalized or normalized == excluded_key or display_key in seen:
            continue
        # Preserve meaningful spelling/separator variants such as T99, T 99,
        # and T/99. The matcher needs those forms when an address appears in a
        # message body rather than as the sender name.
        seen.add(display_key)
        result.append(display)
    return result


def read_customer_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise ValueError(f"customer CSV tidak ditemukan: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = []
        for row in csv.DictReader(source):
            rows.append({name: normalize_display(row.get(name, "")) for name in HEADER})
        return rows


def consolidate_base_rows(
    base_rows: list[dict[str, str]],
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Collapse duplicate customer identities without mutating Supabase."""
    parent = list(range(len(base_rows)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    name_owners: dict[str, int] = {}
    for index, row in enumerate(base_rows):
        key = normalize_key(row.get("name", ""))
        if not key:
            continue
        if key in name_owners:
            union(index, name_owners[key])
        else:
            name_owners[key] = index

    # Merge when one canonical name is explicitly claimed as another row's
    # alias. Alias-to-alias collisions stay unresolved instead of being merged.
    for index, row in enumerate(base_rows):
        for alias in str(row.get("aliases", "")).split(";"):
            owner = name_owners.get(normalize_key(alias))
            if owner is not None and owner != index:
                union(index, owner)

    groups: dict[int, list[int]] = {}
    for index in range(len(base_rows)):
        groups.setdefault(find(index), []).append(index)

    consolidated: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    for indexes in groups.values():
        primary_index = max(
            indexes,
            key=lambda index: (
                len([part for part in str(base_rows[index].get("aliases", "")).split(";") if part.strip()]),
                bool(base_rows[index].get("tag", "")),
                -index,
            ),
        )
        primary = base_rows[primary_index]
        canonical_key = normalize_key(primary.get("name", ""))
        aliases: list[str] = []
        shipping_values: list[str] = []
        tag_values: list[str] = []
        for index in indexes:
            row = base_rows[index]
            aliases.append(row.get("name", ""))
            aliases.extend(str(row.get("aliases", "")).split(";"))
            if row.get("default_shipping", "") not in shipping_values:
                shipping_values.append(row.get("default_shipping", ""))
            if row.get("tag", "") and row.get("tag", "") not in tag_values:
                tag_values.append(row.get("tag", ""))

        merged = {name: primary.get(name, "") for name in HEADER}
        merged["aliases"] = ";".join(unique_values(aliases, excluded_key=canonical_key))
        consolidated.append(merged)
        if len(indexes) > 1:
            warnings.append(
                {
                    "type": "merged_duplicate_customer_identity",
                    "customer": primary.get("name", ""),
                    "detail": ";".join(
                        f"{base_rows[index].get('id', '')}:{base_rows[index].get('name', '')}"
                        for index in indexes
                    ),
                }
            )
        if len(shipping_values) > 1:
            warnings.append(
                {
                    "type": "conflicting_duplicate_shipping",
                    "customer": primary.get("name", ""),
                    "detail": ";".join(shipping_values),
                }
            )
        if len(tag_values) > 1:
            warnings.append(
                {
                    "type": "conflicting_duplicate_tags",
                    "customer": primary.get("name", ""),
                    "detail": ";".join(tag_values),
                }
            )

    consolidated.sort(key=lambda row: (row["name"].casefold(), row["id"]))
    return consolidated, warnings


def parse_parser_mappings(path: Path) -> list[dict[str, object]]:
    if not path.is_file():
        raise ValueError(f"instruksi parser tidak ditemukan: {path}")
    active = False
    mappings: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() == TABLE_HEADING:
            active = True
            continue
        if active and line.startswith("## "):
            break
        if not active or not line.startswith("| **"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        name = re.sub(r"^\*\*|\*\*$", "", cells[0]).strip()
        aliases = re.findall(r'"([^"]+)"', cells[1])
        shipping = re.sub(r"[^0-9]", "", cells[2]) or "0"
        if name:
            mappings.append({"name": name, "shipping": shipping, "aliases": aliases})
    return mappings


def build_reference_rows(
    base_rows: list[dict[str, str]],
    rules_path: Path,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    base_rows, base_warnings = consolidate_base_rows(base_rows)
    mappings = parse_parser_mappings(rules_path)
    if not mappings:
        reference = [{name: row.get(name, "") for name in HEADER} for row in base_rows]
        reference.sort(key=lambda row: (row["name"].casefold(), row["id"]))
        return reference, base_warnings
    consolidated_mappings: dict[str, dict[str, object]] = {}
    duplicate_mapping_warnings: list[dict[str, str]] = []
    for mapping in mappings:
        key = normalize_key(str(mapping["name"]))
        existing = consolidated_mappings.get(key)
        if existing is None:
            consolidated_mappings[key] = {
                "name": mapping["name"],
                "shipping": mapping["shipping"],
                "aliases": list(mapping["aliases"]),
            }
            continue
        existing["aliases"] = unique_values(
            [*list(existing["aliases"]), str(mapping["name"]), *list(mapping["aliases"])],
            excluded_key=key,
        )
        if str(existing["shipping"]) != str(mapping["shipping"]):
            duplicate_mapping_warnings.append(
                {
                    "type": "conflicting_parser_shipping",
                    "customer": str(existing["name"]),
                    "detail": f"{existing['shipping']} vs {mapping['shipping']}",
                }
            )
    mappings = list(consolidated_mappings.values())
    value_index: dict[str, set[int]] = {}
    for index, row in enumerate(base_rows):
        for value in [row.get("name", ""), *str(row.get("aliases", "")).split(";")]:
            key = normalize_key(value)
            if key:
                value_index.setdefault(key, set()).add(index)

    covered: set[int] = set()
    claims: dict[int, list[str]] = {}
    reference: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = [*base_warnings, *duplicate_mapping_warnings]
    used_ids: set[str] = set()

    for mapping in mappings:
        canonical = str(mapping["name"])
        canonical_key = normalize_key(canonical)
        mapping_aliases = [str(value) for value in mapping["aliases"]]
        matched_indexes: set[int] = set()
        for value in [canonical, *mapping_aliases]:
            matched_indexes.update(value_index.get(normalize_key(value), set()))
        covered.update(matched_indexes)
        for index in matched_indexes:
            claims.setdefault(index, []).append(canonical)

        matched = [base_rows[index] for index in sorted(matched_indexes)]
        exact_name = next((row for row in matched if normalize_key(row.get("name", "")) == canonical_key), None)
        primary = exact_name or (matched[0] if matched else None)
        identifier = normalize_display(primary.get("id", "")) if primary else ""
        if not identifier or identifier in used_ids:
            identifier = f"parser:{canonical_key}"
        used_ids.add(identifier)

        tags = unique_values(row.get("tag", "") for row in matched)
        tag = tags[0] if tags else ""
        if len(tags) > 1:
            warnings.append(
                {
                    "type": "conflicting_tags",
                    "customer": canonical,
                    "detail": ";".join(tags),
                }
            )
        inherited_aliases: list[str] = []
        for row in matched:
            inherited_aliases.append(row.get("name", ""))
            inherited_aliases.extend(str(row.get("aliases", "")).split(";"))
        aliases = unique_values([*mapping_aliases, *inherited_aliases], excluded_key=canonical_key)
        reference.append(
            {
                "id": identifier,
                "name": canonical,
                "default_shipping": str(mapping["shipping"]),
                "tag": tag,
                "aliases": ";".join(aliases),
            }
        )

    for index, canonical_names in sorted(claims.items()):
        distinct = unique_values(canonical_names)
        if len(distinct) > 1:
            warnings.append(
                {
                    "type": "base_customer_claimed_twice",
                    "customer": base_rows[index].get("name", ""),
                    "detail": ";".join(distinct),
                }
            )

    for index, row in enumerate(base_rows):
        if index in covered:
            continue
        identifier = row.get("id", "") or f"csv:{normalize_key(row.get('name', ''))}"
        if identifier in used_ids:
            identifier = f"csv:{normalize_key(row.get('name', ''))}"
        used_ids.add(identifier)
        reference.append({name: row.get(name, "") for name in HEADER} | {"id": identifier})

    reference.sort(key=lambda row: (row["name"].casefold(), row["id"]))
    return reference, warnings


def write_csv(path: Path, rows: list[dict[str, str]], header: list[str] = HEADER) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize parser customer names/aliases/ongkir from instruksi_ai_parser.md")
    parser.add_argument("--customers", type=Path, default=ROOT / "customers.csv")
    parser.add_argument("--rules", type=Path, default=ROOT / "instruksi_ai_parser.md")
    parser.add_argument("--output", required=True, type=Path, help="Output CSV; use customers.csv only when intentional")
    parser.add_argument("--warnings", type=Path, help="Optional warning CSV")
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    try:
        base = read_customer_csv(args.customers)
        rows, warnings = build_reference_rows(base, args.rules)
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    write_csv(args.output, rows)
    if args.warnings:
        write_csv(args.warnings, warnings, ["type", "customer", "detail"])
    print(f"Base: {len(base)} | Parser reference: {len(rows)} | Warnings: {len(warnings)}")
    print(f"Output: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
