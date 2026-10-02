export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Sama seperti normalizeKey() di app lama: huruf besar/spasi/trim dibuang,
    supaya "Nasi Goreng" dan "nasi goreng" dianggap item yang sama. */
export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
