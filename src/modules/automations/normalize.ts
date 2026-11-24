// Locale-independent Unicode normalization. No fuzzy matching or transliteration.
export function normalizeKeyword(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\p{White_Space}\uFEFF]+/gu, " ")
    .trim();
}
