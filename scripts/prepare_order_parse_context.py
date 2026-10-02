#!/usr/bin/env python3
"""Prepare a compact, lossless evidence bundle for WhatsApp order parsing.

The script performs deterministic work only: it merges Chat1.txt and Chat2.txt,
deduplicates exports, filters an exact inclusive date-time range, copies the
menu supplied by the user, narrows customer lookup evidence, and prepares
auditable item/note candidates. Candidate extraction is deliberately
conservative: ambiguous links remain marked for AI review. Generated evidence
is stored below ``orderan/hasil-parser/<date range>/`` and never overwrites a
final order CSV.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

from parser_customer_reference import build_reference_rows


ROOT = Path(__file__).resolve().parents[1]
PARSER_OUTPUT_ROOT = ROOT / "orderan" / "hasil-parser"
MONTH_LABELS = ("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")
GENERATED_OUTPUT_FILES = (
    "README.md",
    "chat_range.txt",
    "chat-range.txt",
    "customer_candidates.csv",
    "customer-terdeteksi.csv",
    "customer_reference.csv",
    "customer_reference_warnings.csv",
    "follow_up_modifier_candidates.csv",
    "catatan-susulan.csv",
    "limited_stock_config.csv",
    "stok-terbatas.csv",
    "message_manifest.csv",
    "order_candidates.csv",
    "hasil-parser.csv",
    "order_review_packets.md",
    "review.md",
    "parser_rules_compact.md",
    "run.json",
    "unmatched_senders.csv",
)
STORE_SENDER_KEYS = {"shanticatering", "santicatering"}
INVISIBLE_PREFIXES = "\ufeff\u200e\u200f\u202a\u202b\u202c\u2066\u2067\u2068\u2069"
CHAT_LINE = re.compile(
    r"^\[(?P<date>\d{1,2}/\d{1,2}/\d{2,4}),\s*"
    r"(?P<time>\d{1,2}[.:]\d{2}(?:[.:]\d{2})?)\]\s*"
    r"(?P<sender>[^:]+):\s?(?P<body>.*)$"
)
PACKAGE_SUFFIX = re.compile(r"\s*/\s*\d+(?:[.,]\d+)?\s*$")
MODIFIER_WORDS = re.compile(
    r"\b(?:tidak|tdk|tanpa|pisah|dipisah|pedas|lombok|cabe|cabai|sambal|kuah|"
    r"banyak|sedikit|paha|dada|sayap|jeroan|jerohan|babat|usus|daging|matang|"
    r"matengan|gula|manis|asin|kering|basah|setengah|separuh|1/2|buah|nanas|"
    r"timun|lontong|plastik|bungkus)\b",
    re.IGNORECASE,
)
NON_MODIFIER_MESSAGES = re.compile(
    r"\b(?:transfer|tunai|cash|bayar|lunas|alamat|kirim|antar|terima\s+kasih|"
    r"makasih|matur\s+nuwun|sudah|sdh|oke|ok|iya|ya)\b",
    re.IGNORECASE,
)
OMITTED_MEDIA = re.compile(
    r"\b(?:gambar|foto|stiker|video|audio|dokumen)\s+tidak\s+disertakan\b",
    re.IGNORECASE,
)


@dataclass
class Message:
    timestamp: datetime
    sender: str
    body: str
    source_refs: list[str] = field(default_factory=list)

    @property
    def display_timestamp(self) -> str:
        return self.timestamp.strftime("%d/%m/%Y %H.%M.%S")


@dataclass
class MenuItem:
    name: str
    price: int | None
    stock: float | None
    aliases: list[str]


@dataclass
class Customer:
    identifier: str
    name: str
    shipping: str
    tag: str
    aliases: list[str]


@dataclass
class ItemCandidate:
    candidate_id: str
    sequence: int
    message: Message
    menu_item: MenuItem
    quantity: str
    quantity_rule: str
    line_text: str
    inline_note: str
    accepted_timestamp: datetime
    follow_up_notes: list[str] = field(default_factory=list)
    follow_up_sources: list[str] = field(default_factory=list)
    status: str = "AI_REVIEW"

    @property
    def suggested_note(self) -> str:
        return "; ".join(part for part in [self.inline_note, *self.follow_up_notes] if part)


def normalize_display(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def ascii_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return normalized.encode("ascii", "ignore").decode("ascii").casefold()


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", ascii_text(value).replace("²", "2"))


def is_store_sender(value: str) -> bool:
    return normalize_key(value) in STORE_SENDER_KEYS


def word_tokens(value: str) -> list[str]:
    return re.findall(r"[a-z]+|\d+", ascii_text(value))


def format_number(value: float | int | None) -> str:
    if value is None:
        return "unlimited"
    number = float(value)
    return str(int(number)) if number.is_integer() else ("%.3f" % number).rstrip("0").rstrip(".")


def parse_positive_number(value: str) -> float | None:
    raw = normalize_display(value).replace(",", ".")
    if not raw:
        return None
    try:
        number = float(raw)
    except ValueError:
        return None
    return number if number > 0 else None


def parse_price(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    return int(digits) if digits else None


def parse_stock(value: str) -> float | None:
    raw = normalize_key(value)
    if not raw or raw in {"unlimited", "takterbatas", "tanpabatas"}:
        return None
    return parse_positive_number(value)


def parse_chat_timestamp(date_text: str, time_text: str) -> datetime:
    clean_time = time_text.replace(".", ":")
    for date_format in ("%d/%m/%Y", "%d/%m/%y"):
        for time_format in ("%H:%M:%S", "%H:%M"):
            try:
                return datetime.strptime(f"{date_text} {clean_time}", f"{date_format} {time_format}")
            except ValueError:
                pass
    raise ValueError(f"Timestamp chat tidak dikenal: {date_text} {time_text}")


def parse_cli_timestamp(value: str) -> datetime:
    clean = normalize_display(value).replace(".", ":")
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        for time_format in ("%H:%M:%S", "%H:%M"):
            try:
                return datetime.strptime(clean, f"{date_format} {time_format}")
            except ValueError:
                pass
    raise argparse.ArgumentTypeError(
        "Gunakan tanggal dan jam lengkap, misalnya 2026-07-25 19:00 atau 25/07/2026 19:00"
    )


def parse_chat_file(path: Path) -> list[Message]:
    messages: list[Message] = []
    current: Message | None = None
    with path.open("r", encoding="utf-8-sig", errors="replace") as source:
        for line_number, raw_line in enumerate(source, start=1):
            line = raw_line.rstrip("\r\n").lstrip(INVISIBLE_PREFIXES)
            match = CHAT_LINE.match(line)
            if match:
                try:
                    timestamp = parse_chat_timestamp(match.group("date"), match.group("time"))
                except ValueError:
                    current = None
                    continue
                current = Message(
                    timestamp=timestamp,
                    sender=normalize_display(match.group("sender")),
                    body=match.group("body").strip(),
                    source_refs=[f"{path.name}:{line_number}"],
                )
                messages.append(current)
            elif current is not None and line.strip():
                current.body = f"{current.body}\n{line.strip()}".strip()
                current.source_refs.append(f"{path.name}:{line_number}")
    return messages


def merge_messages(messages: Iterable[Message]) -> list[Message]:
    merged: dict[tuple[datetime, str, str], Message] = {}
    for message in messages:
        # Deduplicate only the same exported message. Punctuation can carry
        # meaning (for example 1/2 versus 12), so it must remain in the key.
        key = (
            message.timestamp,
            normalize_display(message.sender).casefold(),
            re.sub(r"\s+", " ", message.body).strip().casefold(),
        )
        if key not in merged:
            merged[key] = message
        else:
            merged[key].source_refs.extend(message.source_refs)
    return sorted(merged.values(), key=lambda item: (item.timestamp, item.sender.casefold(), item.body))


def read_table(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        sample = source.read(4096)
        source.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        return [{str(key or ""): str(value or "") for key, value in row.items()} for row in csv.DictReader(source, dialect=dialect)]


def first_value(row: dict[str, str], names: Iterable[str]) -> str:
    lookup = {normalize_key(key): value for key, value in row.items()}
    for name in names:
        if normalize_key(name) in lookup:
            return lookup[normalize_key(name)]
    return ""


def parse_menu_line(value: str) -> MenuItem:
    parts = [part.strip() for part in value.split("|")]
    if not parts or not parts[0]:
        raise ValueError("Format --menu-line: Nama|Harga|Stok|alias 1;alias 2")
    aliases = [parts[0]]
    if len(parts) > 3:
        aliases.extend(alias.strip() for alias in parts[3].split(";") if alias.strip())
    return MenuItem(
        name=parts[0],
        price=parse_price(parts[1]) if len(parts) > 1 else None,
        stock=parse_stock(parts[2]) if len(parts) > 2 else None,
        aliases=list(dict.fromkeys(aliases)),
    )


def load_menu(menu_file: Path | None, menu_lines: list[str]) -> list[MenuItem]:
    items = [parse_menu_line(line) for line in menu_lines]
    if menu_file:
        if not menu_file.is_file():
            raise ValueError(f"File menu tidak ditemukan: {menu_file}")
        for row in read_table(menu_file):
            name = normalize_display(first_value(row, ("nama", "name", "item", "menu")))
            if not name:
                continue
            alias_text = first_value(row, ("aliases", "alias"))
            aliases = [name, *(part.strip() for part in alias_text.split(";") if part.strip())]
            items.append(
                MenuItem(
                    name=name,
                    price=parse_price(first_value(row, ("harga", "price"))),
                    stock=parse_stock(first_value(row, ("stok", "stock"))),
                    aliases=list(dict.fromkeys(aliases)),
                )
            )
    unique: dict[str, MenuItem] = {}
    for item in items:
        key = normalize_key(item.name)
        if not key:
            continue
        if key in unique:
            raise ValueError(f"Menu duplikat: {item.name}")
        unique[key] = item
    if not unique:
        raise ValueError("Menu kosong. Berikan --menu-line berulang atau --menu-file.")
    return list(unique.values())


def load_customers(path: Path, rules_path: Path) -> tuple[list[Customer], list[dict[str, str]], list[dict[str, str]]]:
    if not path.is_file():
        raise ValueError(f"File customer tidak ditemukan: {path}")
    base_rows = read_table(path)
    reference_rows, warnings = build_reference_rows(base_rows, rules_path)
    customers: list[Customer] = []
    for row in reference_rows:
        name = normalize_display(first_value(row, ("name", "nama")))
        if not name:
            continue
        aliases = [normalize_display(part) for part in first_value(row, ("aliases", "alias")).split(";") if part.strip()]
        customers.append(
            Customer(
                identifier=normalize_display(first_value(row, ("id",))),
                name=name,
                shipping=normalize_display(first_value(row, ("default_shipping", "ongkir"))),
                tag=normalize_display(first_value(row, ("tag",))),
                aliases=aliases,
            )
        )
    return customers, reference_rows, warnings


def phrase_pattern(value: str) -> re.Pattern[str] | None:
    tokens = word_tokens(value)
    if not tokens:
        return None
    expression = r"[^a-z0-9]+".join(re.escape(token) for token in tokens)
    return re.compile(rf"(?<![a-z0-9]){expression}(?![a-z0-9])", re.IGNORECASE)


def is_specific_customer_phrase(value: str) -> bool:
    """Allow only complete address-like aliases in message-body lookup."""
    tokens = word_tokens(value)
    words = [token for token in tokens if token.isalpha()]
    numbers = [token for token in tokens if token.isdigit()]
    if len(normalize_key(value)) < 4 or not words:
        return False
    return bool(numbers) or len(words) >= 2


def customer_candidate_rows(messages: list[Message], customers: list[Customer]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    sender_messages: dict[str, list[Message]] = defaultdict(list)
    sender_display: dict[str, str] = {}
    for message in messages:
        if is_store_sender(message.sender):
            continue
        key = normalize_key(message.sender)
        sender_display.setdefault(key, message.sender)
        sender_messages[key].append(message)

    rows: list[dict[str, str]] = []
    matched_senders: set[str] = set()
    for sender_key, related in sender_messages.items():
        sender = sender_display[sender_key]
        body_evidence_ascii = ascii_text("\n".join(message.body for message in related))
        exact_sender_rows: list[dict[str, str]] = []
        exact_phrase_rows: list[dict[str, str]] = []
        for customer in customers:
            values = [customer.name, *customer.aliases]
            reasons: list[tuple[int, str, str]] = []
            for value in values:
                value_key = normalize_key(value)
                if value_key and value_key == sender_key:
                    reasons.append((0, "exact_sender", value))
                    continue
                pattern = phrase_pattern(value)
                if pattern and is_specific_customer_phrase(value) and pattern.search(body_evidence_ascii):
                    reasons.append((1, "exact_address_phrase", value))
            if not reasons:
                continue
            priority, match_type, matched_by = min(reasons, key=lambda item: (item[0], -len(item[2])))
            match_row = {
                "sender": sender,
                "matchType": match_type,
                "matchedBy": matched_by,
                "id": customer.identifier,
                "name": customer.name,
                "default_shipping": customer.shipping,
                "tag": customer.tag,
                "aliases": ";".join(customer.aliases),
            }
            if priority == 0:
                exact_sender_rows.append(match_row)
            else:
                exact_phrase_rows.append(match_row)

        # An exact sender identity wins over destinations mentioned in the
        # body, because those may be alternate delivery addresses.
        sender_rows = exact_sender_rows or exact_phrase_rows
        if sender_rows:
            rows.extend(sender_rows)
            matched_senders.add(sender_key)

    rows.sort(
        key=lambda row: (
            row["sender"].casefold(),
            {"exact_sender": 0, "exact_address_phrase": 1}.get(row["matchType"], 2),
            row["name"].casefold(),
        )
    )
    unmatched = []
    for sender_key, related in sender_messages.items():
        if sender_key in matched_senders:
            continue
        unmatched.append(
            {
                "sender": sender_display[sender_key],
                "firstTimestamp": related[0].display_timestamp,
                "messageCount": str(len(related)),
            }
        )
    unmatched.sort(key=lambda row: (datetime.strptime(row["firstTimestamp"], "%d/%m/%Y %H.%M.%S"), row["sender"].casefold()))
    return rows, unmatched


def menu_alias_variants(item: MenuItem) -> list[str]:
    variants: list[str] = []
    seen_keys: set[str] = set()
    for value in [item.name, *item.aliases]:
        clean = normalize_display(value)
        short = PACKAGE_SUFFIX.sub("", clean)
        for candidate in (clean, short):
            if candidate:
                key = normalize_key(candidate)
                if key not in seen_keys:
                    seen_keys.add(key)
                    variants.append(candidate)
        # Generate all word-prefix variants for multi-word items
        words = [token for token in word_tokens(short) if token.isalpha()]
        for i in range(len(words), 0, -1):
            prefix = " ".join(words[:i])
            key = normalize_key(prefix)
            if key and key not in seen_keys:
                seen_keys.add(key)
                variants.append(prefix)
        # Generate word-suffix variants (e.g., "Dawet" from "Es Dawet")
        for i in range(1, len(words)):
            suffix = " ".join(words[i:])
            key = normalize_key(suffix)
            if key and len(suffix) >= 4 and key not in seen_keys:
                seen_keys.add(key)
                variants.append(suffix)
        # Single repeated word (original behavior)
        if len(words) >= 2 and len(set(words)) == 1:
            key = normalize_key(words[0])
            if key not in seen_keys:
                seen_keys.add(key)
                variants.append(words[0])
    return sorted(variants, key=lambda value: len(normalize_key(value)), reverse=True)


def _levenshtein(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if not s2:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (c1 != c2)))
        prev = curr
    return prev[-1]


def menu_phrase_pattern(value: str) -> re.Pattern[str] | None:
    chunks = re.findall(r"[a-z0-9]+", ascii_text(value))
    if not chunks:
        return None
    expression = r"[^a-z0-9]+".join(re.escape(chunk) for chunk in chunks)
    return re.compile(rf"(?<![a-z0-9]){expression}(?![a-z0-9])", re.IGNORECASE)


def ordered_menu_matches(line: str, menu: list[MenuItem]) -> list[tuple[int, int, MenuItem, str]]:
    searchable = ascii_text(line)
    matches: list[tuple[int, int, MenuItem, str]] = []
    matched_positions: set[int] = set()
    items_matched_exactly: set[str] = set()  # by item name

    # First pass: exact phrase matches
    for item in menu:
        best: tuple[int, int, MenuItem, str] | None = None
        for alias in menu_alias_variants(item):
            pattern = menu_phrase_pattern(alias)
            match = pattern.search(searchable) if pattern else None
            if not match:
                continue
            candidate = (match.start(), match.end(), item, alias)
            if best is None or (candidate[0], -(candidate[1] - candidate[0])) < (best[0], -(best[1] - best[0])):
                best = candidate
        if best is not None:
            matches.append(best)
            items_matched_exactly.add(item.name)
            for p in range(best[0], best[1]):
                matched_positions.add(p)

    # Second pass: fuzzy word matches for unmatched tokens (typos, 1-char edit distance)
    # ONLY match the FIRST word of each menu item alias to avoid false positives
    for m in re.finditer(r"[a-z0-9]+", searchable):
        if any(p in matched_positions for p in range(m.start(), m.end())):
            continue
        token = searchable[m.start():m.end()]
        if len(token) < 4:
            continue
        for item in menu:
            # Skip if this item already has an exact match on this line
            if item.name in items_matched_exactly:
                continue
            # Only fuzzy-match the FIRST word of the ORIGINAL item name
            # (not generated suffix aliases, to avoid false positives)
            # Also skip if token is ambiguous (matches multiple items)
            item_first_word = re.findall(r"[a-z0-9]+", ascii_text(item.name))
            if item_first_word:
                aw = item_first_word[0]
                if len(aw) >= 4 and _levenshtein(aw, token) <= 1:
                    # Check if this token also matches another item's first word
                    ambiguous = False
                    for other_item in menu:
                        if other_item.name == item.name:
                            continue
                        other_first = re.findall(r"[a-z0-9]+", ascii_text(other_item.name))
                        if other_first and len(other_first[0]) >= 4 and _levenshtein(other_first[0], token) <= 1:
                            ambiguous = True
                            break
                    if not ambiguous:
                        matches.append((m.start(), m.end(), item, item.name + " [FUZZY]"))
                        for p in range(m.start(), m.end()):
                            matched_positions.add(p)
                        break
            if any(p in matched_positions for p in range(m.start(), m.end())):
                break

    # DEDUPLICATION: same item with overlapping/adjacent spans → keep longest
    matches.sort(key=lambda value: (value[0], -(value[1] - value[0])))
    filtered: list[tuple[int, int, MenuItem, str]] = []
    for match in matches:
        start, end, item, alias = match
        overlap = False
        for i, (fs, fe, fi, fa) in enumerate(filtered):
            if fi == item:
                # If spans overlap or are within 3 chars of each other
                if not (end < fs - 3 or start > fe + 3):
                    # Keep the longer match
                    if (end - start) > (fe - fs):
                        filtered[i] = match
                    overlap = True
                    break
        if not overlap:
            filtered.append(match)

    return sorted(filtered, key=lambda value: (value[0], -(value[1] - value[0]), value[2].name.casefold()))


def clean_quantity(value: str) -> str:
    raw = normalize_display(value).replace(",", ".")
    if "/" in raw:
        return raw
    try:
        number = float(raw)
    except ValueError:
        return raw
    return str(int(number)) if number.is_integer() else str(number)


def quantity_candidate(line: str, start: int, end: int) -> tuple[str, str]:
    before = ascii_text(line)[:start]
    after = ascii_text(line)[end:]

    def _looks_like_price(text: str, match_obj: re.Match) -> bool:
        """Check if a matched number is preceded by price indicators."""
        num_start = match_obj.start(1)
        prefix = text[max(0, num_start - 15):num_start]
        return bool(re.search(r"(?:rp|harga|rb|ribu)\s*$", prefix, re.IGNORECASE))

    patterns = (
        (after, r"^\s*[:=\-]?\s*\(\s*(\d+(?:[.,/]\d+)?)\s*\)\s*$", "after_parenthesized"),
        (after, r"^\s*[:=\-]?\s*(\d+(?:[.,/]\d+)?)\s*(?:x|porsi|pcs|biji|bungkus)?\b", "after_item"),
        (after, r"^\s*(?:nya\b)?\s*(\d+(?:[.,/]\d+)?)\s*(?:x|porsi|pcs|biji|bungkus)\b", "after_item_filler"),
        (after, r"(?:^|[^a-z0-9])\(?\s*(\d+(?:[.,/]\d+)?)\s*\)?\s*(?:x|porsi|pcs|biji|bungkus)?\s*$", "line_ending"),
        (before, r"(\d+(?:[.,/]\d+)?)\s*(?:x|porsi|pcs|biji|bungkus)?\s*$", "before_item"),
    )
    for haystack, expression, rule in patterns:
        match = re.search(expression, haystack, re.IGNORECASE)
        if match:
            if _looks_like_price(haystack, match):
                continue
            return clean_quantity(match.group(1)), rule

    # Fallback: any trailing number at the end of the entire line
    full_line = ascii_text(line)
    trailing_match = re.search(r"(\d+(?:[.,/]\d+)?)\s*(?:x|porsi|pcs|biji|bungkus)?\s*[.!?]*\s*$", full_line, re.IGNORECASE)
    if trailing_match:
        if not _looks_like_price(full_line, trailing_match):
            return clean_quantity(trailing_match.group(1)), "line_trailing"

    return "1", "implicit_one_ai_confirm"


def inline_note_candidate(line: str, end: int) -> str:
    tail = line[end:].strip()
    tail = re.sub(r"^\s*[:=\-]?\s*\d+(?:[.,/]\d+)?\s*(?:x|porsi|pcs|biji|bungkus)?", "", tail, flags=re.IGNORECASE)
    tail = re.sub(r"\(?\s*\d+(?:[.,/]\d+)?\s*\)?\s*(?:x|porsi|pcs|biji|bungkus)?\s*$", "", tail, flags=re.IGNORECASE)
    tail = tail.strip(" \t:;,.-")
    if not tail:
        return ""
    if tail.startswith("(") or MODIFIER_WORDS.search(ascii_text(tail)):
        return normalize_display(tail.strip("() "))
    return ""


def is_standalone_modifier(message: Message, menu: list[MenuItem]) -> bool:
    body = normalize_display(message.body)
    if not body or len(body) > 100 or len(message.body.splitlines()) > 2:
        return False
    if any(ordered_menu_matches(line, menu) for line in message.body.splitlines()):
        return False
    searchable = ascii_text(body)
    if OMITTED_MEDIA.search(searchable):
        return False
    return bool(MODIFIER_WORDS.search(searchable)) and not bool(NON_MODIFIER_MESSAGES.search(searchable))


def build_item_candidates(
    messages: list[Message], menu: list[MenuItem]
) -> tuple[list[ItemCandidate], list[dict[str, str]]]:
    candidates: list[ItemCandidate] = []
    by_sender: dict[str, list[ItemCandidate]] = defaultdict(list)
    modifier_rows: list[dict[str, str]] = []

    for sequence, message in enumerate(messages, start=1):
        if is_store_sender(message.sender):
            continue
        message_candidates: list[ItemCandidate] = []
        for line in (line.strip() for line in message.body.splitlines() if line.strip()):
            for start, end, item, _alias in ordered_menu_matches(line, menu):
                quantity, quantity_rule = quantity_candidate(line, start, end)
                candidate = ItemCandidate(
                    candidate_id=f"C{len(candidates) + 1:04d}",
                    sequence=sequence,
                    message=message,
                    menu_item=item,
                    quantity=quantity,
                    quantity_rule=quantity_rule,
                    line_text=normalize_display(line),
                    inline_note=inline_note_candidate(line, end),
                    accepted_timestamp=message.timestamp,
                )
                candidates.append(candidate)
                message_candidates.append(candidate)
                by_sender[normalize_key(message.sender)].append(candidate)

        if message_candidates or not is_standalone_modifier(message, menu):
            continue

        sender_candidates = by_sender.get(normalize_key(message.sender), [])
        recent = [
            candidate
            for candidate in sender_candidates
            if 0 <= (message.timestamp - candidate.message.timestamp).total_seconds() <= 30 * 60
        ]
        target: ItemCandidate | None = None
        reason = "no recent menu candidate from the same sender"
        link_status = "UNRESOLVED_AI_REVIEW"
        latest: list[ItemCandidate] = []
        if recent:
            latest_sequence = max(candidate.sequence for candidate in recent)
            latest = [candidate for candidate in recent if candidate.sequence == latest_sequence]
            with_preparation_note = [candidate for candidate in latest if candidate.inline_note]
            if len(with_preparation_note) == 1:
                target = with_preparation_note[0]
                reason = "only recent item already carrying preparation modifiers"
                link_status = "SUGGESTED_AI_CONFIRM"
            elif len(latest) == 1:
                target = latest[0]
                reason = "only menu item in the most recent order message"
                link_status = "SUGGESTED_AI_REVIEW"
            else:
                reason = "multiple equally plausible items in the most recent order message"

        refs = ";".join(sorted(set(message.source_refs)))
        if target is not None:
            note = normalize_display(message.body)
            target.follow_up_notes.append(note)
            target.follow_up_sources.append(refs)
            target.status = "FOLLOW_UP_LINK_SUGGESTED_AI_CONFIRM"
            for candidate in latest:
                candidate.accepted_timestamp = message.timestamp
        modifier_rows.append(
            {
                "sequence": str(sequence),
                "timestamp": message.display_timestamp,
                "sender": message.sender,
                "modifier": normalize_display(message.body),
                "targetCandidateId": target.candidate_id if target else "",
                "targetItem": target.menu_item.name if target else "",
                "status": link_status,
                "reason": reason,
                "source": refs,
            }
        )
    return candidates, modifier_rows


def summarize_customer_matches(matches: list[dict[str, str]]) -> dict[str, str]:
    names = list(dict.fromkeys(row["name"] for row in matches))
    shipping = list(dict.fromkeys(row["default_shipping"] for row in matches if row["default_shipping"]))
    tags = list(dict.fromkeys(row["tag"] for row in matches if row["tag"]))
    match_types = list(dict.fromkeys(row["matchType"] for row in matches))
    matched_by = list(dict.fromkeys(row["matchedBy"] for row in matches))
    if len(names) == 1:
        status = "UNIQUE_STRICT_MATCH_AI_CONFIRM"
    elif names:
        status = "AMBIGUOUS_EXACT_AI_REVIEW"
    else:
        status = "UNMATCHED_AI_REVIEW"
    return {
        "customer": "; ".join(names),
        "ongkir": "; ".join(shipping),
        "tag": "; ".join(tags),
        "status": status,
        "matchType": "; ".join(match_types),
        "matchedBy": "; ".join(matched_by),
    }


def detected_customer_rows(
    candidates: list[ItemCandidate], customer_rows: list[dict[str, str]]
) -> list[dict[str, str]]:
    customers_by_sender: dict[str, list[dict[str, str]]] = defaultdict(list)
    candidates_by_sender: dict[str, list[ItemCandidate]] = defaultdict(list)
    for row in customer_rows:
        customers_by_sender[normalize_key(row["sender"])].append(row)
    for candidate in candidates:
        candidates_by_sender[normalize_key(candidate.message.sender)].append(candidate)

    rows: list[dict[str, str]] = []
    sender_keys = sorted(
        candidates_by_sender,
        key=lambda key: min(candidate.sequence for candidate in candidates_by_sender[key]),
    )
    for sender_key in sender_keys:
        related = candidates_by_sender[sender_key]
        summary = summarize_customer_matches(customers_by_sender.get(sender_key, []))
        rows.append(
            {
                "sender": related[0].message.sender,
                "customer": summary["customer"],
                "ongkir": summary["ongkir"],
                "tag": summary["tag"],
                "matchStatus": summary["status"],
                "matchType": summary["matchType"],
                "matchedBy": summary["matchedBy"],
                "itemCandidateCount": str(len(related)),
                "firstOrderEvidence": min(candidate.message.timestamp for candidate in related).strftime(
                    "%d/%m/%Y %H.%M.%S"
                ),
            }
        )
    return rows


def candidate_rows(candidates: list[ItemCandidate], customer_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    customers_by_sender: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in customer_rows:
        customers_by_sender[normalize_key(row["sender"])].append(row)

    rows: list[dict[str, str]] = []
    for candidate in candidates:
        customer_matches = customers_by_sender.get(normalize_key(candidate.message.sender), [])
        customer_summary = summarize_customer_matches(customer_matches)
        rows.append({
            "candidateId": candidate.candidate_id,
            "sequence": str(candidate.sequence),
            "firstEvidenceTimestamp": candidate.message.display_timestamp,
            "orderTimestampCandidate": candidate.accepted_timestamp.strftime("%d/%m/%Y %H.%M.%S"),
            "sender": candidate.message.sender,
            "customerCandidate": customer_summary["customer"],
            "ongkirCandidate": customer_summary["ongkir"],
            "customerStatus": customer_summary["status"],
            "item": candidate.menu_item.name,
            "quantityCandidate": candidate.quantity,
            "quantityRule": candidate.quantity_rule,
            "inlineNoteCandidate": candidate.inline_note,
            "followUpNoteCandidate": "; ".join(candidate.follow_up_notes),
            "suggestedNote": candidate.suggested_note,
            "status": candidate.status,
            "source": ";".join(sorted(set([*candidate.message.source_refs, *candidate.follow_up_sources]))),
            "evidence": candidate.line_text,
        })
    return rows


def build_order_review_packets(
    messages: list[Message], candidates: list[ItemCandidate], customer_rows: list[dict[str, str]]
) -> str:
    messages_by_sender: dict[str, list[tuple[int, Message]]] = defaultdict(list)
    candidates_by_sender: dict[str, list[ItemCandidate]] = defaultdict(list)
    customers_by_sender: dict[str, list[dict[str, str]]] = defaultdict(list)
    for sequence, message in enumerate(messages, start=1):
        messages_by_sender[normalize_key(message.sender)].append((sequence, message))
    for candidate in candidates:
        candidates_by_sender[normalize_key(candidate.message.sender)].append(candidate)
    for row in customer_rows:
        customers_by_sender[normalize_key(row["sender"])].append(row)

    sender_keys = sorted(
        candidates_by_sender,
        key=lambda key: min(candidate.sequence for candidate in candidates_by_sender[key]),
    )
    blocks: list[str] = []
    for sender_key in sender_keys:
        related_messages = messages_by_sender[sender_key]
        sender = related_messages[0][1].sender
        customer_text = " | ".join(
            f"{row['name']} (ongkir {row['default_shipping'] or '?'}, {row['matchType']})"
            for row in customers_by_sender.get(sender_key, [])[:5]
        ) or "UNMATCHED - AI/user review required"
        lines = [f"## {sender}", f"CUSTOMER: {customer_text}", "", "ITEM CANDIDATES:"]
        for candidate in candidates_by_sender[sender_key]:
            note = candidate.suggested_note or "-"
            lines.append(
                f"- {candidate.candidate_id} [{candidate.message.display_timestamp}] "
                f"{candidate.menu_item.name} | qty={candidate.quantity} ({candidate.quantity_rule}) "
                f"| note={note} | {candidate.status}"
            )
        lines.extend(["", "FULL EVIDENCE:"])
        for sequence, message in related_messages:
            refs = ";".join(sorted(set(message.source_refs)))
            body = message.body.replace("\n", " | ")
            lines.append(f"- [{sequence:04d}] {message.display_timestamp} | {body} | SOURCE: {refs}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, str]]) -> int:
    count = 0
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def default_output_dir(start: datetime, end: datetime) -> Path:
    if start.date() == end.date():
        label = f"{start.day} {MONTH_LABELS[start.month - 1]} {start.year}"
    elif start.year == end.year and start.month == end.month:
        label = f"{start.day}-{end.day} {MONTH_LABELS[start.month - 1]} {start.year}"
    elif start.year == end.year:
        label = (
            f"{start.day} {MONTH_LABELS[start.month - 1]}-"
            f"{end.day} {MONTH_LABELS[end.month - 1]} {start.year}"
        )
    else:
        label = (
            f"{start.day} {MONTH_LABELS[start.month - 1]} {start.year}-"
            f"{end.day} {MONTH_LABELS[end.month - 1]} {end.year}"
        )
    return PARSER_OUTPUT_ROOT / label


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a lossless exact-range evidence pack from both WhatsApp exports.")
    parser.add_argument("--start", required=True, type=parse_cli_timestamp, help="Inclusive date and time")
    parser.add_argument("--end", required=True, type=parse_cli_timestamp, help="Inclusive date and time")
    parser.add_argument("--chat", action="append", type=Path, help="Repeat twice. Defaults to Chat1.txt and Chat2.txt.")
    parser.add_argument("--customers", type=Path, default=ROOT / "customers.csv")
    parser.add_argument("--customer-rules", type=Path, default=ROOT / "instruksi_ai_parser.md")
    parser.add_argument("--menu-file", type=Path)
    parser.add_argument("--menu-line", action="append", default=[], help="Nama|Harga|Stok|alias 1;alias 2")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Optional custom new directory. Default: orderan/hasil-parser/<date range>, refreshed in place.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    if args.end < args.start:
        print("ERROR: --end tidak boleh lebih awal dari --start", file=sys.stderr)
        return 2
    chat_paths = args.chat or [ROOT / "Chat1.txt", ROOT / "Chat2.txt"]
    if len(chat_paths) != 2:
        print("ERROR: tepat dua --chat wajib dipakai", file=sys.stderr)
        return 2
    for path in [*chat_paths, args.customers, args.customer_rules]:
        if not path.is_file():
            print(f"ERROR: file tidak ditemukan: {path}", file=sys.stderr)
            return 2
    try:
        menu = load_menu(args.menu_file, args.menu_line)
        customers, customer_reference_rows, customer_reference_warnings = load_customers(
            args.customers, args.customer_rules
        )
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    all_messages = merge_messages(message for path in chat_paths for message in parse_chat_file(path))
    messages = [message for message in all_messages if args.start <= message.timestamp <= args.end]
    customer_rows, unmatched_rows = customer_candidate_rows(messages, customers)
    item_candidates, modifier_rows = build_item_candidates(messages, menu)
    detected_customers = detected_customer_rows(item_candidates, customer_rows)
    uses_default_output = args.output_dir is None
    output_dir = args.output_dir or default_output_dir(args.start, args.end)
    orderan_dir = (ROOT / "orderan").resolve()
    parser_output_dir = PARSER_OUTPUT_ROOT.resolve()
    try:
        relative_orderan_path = output_dir.resolve().relative_to(orderan_dir)
    except ValueError:
        pass
    else:
        try:
            output_dir.resolve().relative_to(parser_output_dir)
        except ValueError:
            print(
                f"ERROR: bundle parser di dalam orderan/ hanya boleh berada di {PARSER_OUTPUT_ROOT}",
                file=sys.stderr,
            )
            return 2
        if not relative_orderan_path.parts:
            print("ERROR: folder orderan/ utama tidak boleh dijadikan output parser", file=sys.stderr)
            return 2
    if output_dir.exists() and not uses_default_output:
        print(f"ERROR: output sudah ada: {output_dir}", file=sys.stderr)
        return 2
    output_dir.mkdir(parents=True, exist_ok=uses_default_output)
    for filename in GENERATED_OUTPUT_FILES:
        (output_dir / filename).unlink(missing_ok=True)

    chat_blocks = []
    for sequence, message in enumerate(messages, start=1):
        refs = ";".join(sorted(set(message.source_refs)))
        chat_blocks.append(f"### {sequence:04d} | {message.display_timestamp} | {message.sender}\n{message.body}\nSOURCE: {refs}")
    (output_dir / "chat-range.txt").write_text(
        "\n\n".join(chat_blocks) + ("\n" if chat_blocks else ""), encoding="utf-8"
    )
    write_csv(
        output_dir / "customer-terdeteksi.csv",
        [
            "sender",
            "customer",
            "ongkir",
            "tag",
            "matchStatus",
            "matchType",
            "matchedBy",
            "itemCandidateCount",
            "firstOrderEvidence",
        ],
        detected_customers,
    )
    write_csv(
        output_dir / "hasil-parser.csv",
        [
            "candidateId",
            "sequence",
            "firstEvidenceTimestamp",
            "orderTimestampCandidate",
            "sender",
            "customerCandidate",
            "ongkirCandidate",
            "customerStatus",
            "item",
            "quantityCandidate",
            "quantityRule",
            "inlineNoteCandidate",
            "followUpNoteCandidate",
            "suggestedNote",
            "status",
            "source",
            "evidence",
        ],
        candidate_rows(item_candidates, customer_rows),
    )
    if modifier_rows:
        write_csv(
            output_dir / "catatan-susulan.csv",
            ["sequence", "timestamp", "sender", "modifier", "targetCandidateId", "targetItem", "status", "reason", "source"],
            modifier_rows,
        )
    (output_dir / "review.md").write_text(
        build_order_review_packets(messages, item_candidates, customer_rows), encoding="utf-8"
    )
    menu_rows = [
        {"item": item.name, "price": "" if item.price is None else str(item.price), "stock": format_number(item.stock), "aliases": ";".join(item.aliases[1:])}
        for item in menu
    ]
    write_csv(output_dir / "menu.csv", ["item", "price", "stock", "aliases"], menu_rows)
    limited = [{"item": item.name, "stock": format_number(item.stock), "availableFrom": ""} for item in menu if item.stock is not None]
    if limited:
        write_csv(output_dir / "stok-terbatas.csv", ["item", "stock", "availableFrom"], limited)
    run = {
        "scope": {"start": args.start.isoformat(sep=" "), "end": args.end.isoformat(sep=" "), "inclusive": True},
        "sources": [{"path": str(path), "sha256": file_hash(path)} for path in chat_paths],
        "customers": {
            "path": str(args.customers),
            "sha256": file_hash(args.customers),
            "rulesPath": str(args.customer_rules),
            "rulesSha256": file_hash(args.customer_rules),
            "referenceRows": len(customers),
            "referenceWarnings": len(customer_reference_warnings),
        },
        "counts": {
            "messagesInRange": len(messages),
            "storeMessages": sum(is_store_sender(message.sender) for message in messages),
            "customerMessagesScanned": sum(not is_store_sender(message.sender) for message in messages),
            "distinctSenders": len(
                {normalize_key(message.sender) for message in messages if not is_store_sender(message.sender)}
            ),
            "customerCandidateRows": len(customer_rows),
            "detectedOrderSenders": len(detected_customers),
            "unresolvedOrderSenders": sum(
                row["matchStatus"] != "UNIQUE_STRICT_MATCH_AI_CONFIRM" for row in detected_customers
            ),
            "unmatchedSenders": len(unmatched_rows),
            "menuItems": len(menu),
            "limitedMenuItems": len(limited),
            "itemCandidates": len(item_candidates),
            "followUpModifierCandidates": len(modifier_rows),
        },
        "warning": "hasil-parser.csv contains conservative suggestions, not final orders. AI review and CSV QA remain mandatory.",
    }
    (output_dir / "run.json").write_text(json.dumps(run, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Scope: {args.start:%d/%m/%Y %H.%M.%S} -> {args.end:%d/%m/%Y %H.%M.%S} (inclusive)")
    print(
        f"Messages: {len(messages)} | Senders: {run['counts']['distinctSenders']} "
        f"| Item candidates: {len(item_candidates)} | Follow-up modifiers: {len(modifier_rows)}"
    )
    print(f"Output: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
