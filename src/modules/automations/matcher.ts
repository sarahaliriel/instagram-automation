import { normalizeKeyword } from "./normalize";

export const MATCHING_ENGINE_VERSION = "matching-v1";
export type MatchingRule = {
  id: string;
  accountId: string;
  enabled: boolean;
  strategy: "EXACT" | "WHOLE_WORD";
  scope: "GLOBAL" | "MEDIA";
  mediaId: string | null;
  priority: number;
  keywords: readonly { id: string; normalizedKeyword: string }[];
};
export type MatchingDecision =
  | { kind: "MATCHED"; ruleId: string; keywordId: string }
  | {
      kind: "SKIPPED";
      reason: "COMMENT_WITHOUT_TEXT" | "EMPTY_COMMENT" | "NO_MATCHING_RULE";
    };

// Explicit ordinal comparison; never use host-dependent locale collation.
function compareId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
const wordCharacter = /[\p{L}\p{N}\p{M}\p{Pc}]/u;
function containsWholeKeyword(text: string, keyword: string) {
  if (!keyword) return false;
  let start = text.indexOf(keyword);
  while (start !== -1) {
    // Read at most two UTF-16 units per boundary, including supplementary letters.
    const unit = text.charCodeAt(start - 1);
    const before =
      start === 0
        ? undefined
        : text.slice(start - (unit >= 0xdc00 && unit <= 0xdfff ? 2 : 1), start);
    const codePoint = text.codePointAt(start + keyword.length);
    const after =
      codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
    if (
      (!before || !wordCharacter.test(before)) &&
      (!after || !wordCharacter.test(after))
    )
      return true;
    start = text.indexOf(keyword, start + 1);
  }
  return false;
}

export function matchAutomation(
  input: {
    accountId: string;
    mediaId: string;
    text: string | null | undefined;
  },
  rules: readonly MatchingRule[],
): MatchingDecision {
  if (input.text == null)
    return { kind: "SKIPPED", reason: "COMMENT_WITHOUT_TEXT" };
  const text = normalizeKeyword(input.text);
  if (!text) return { kind: "SKIPPED", reason: "EMPTY_COMMENT" };
  const eligible = rules
    .filter(
      (rule) =>
        rule.enabled &&
        rule.accountId === input.accountId &&
        (rule.scope === "MEDIA"
          ? rule.mediaId === input.mediaId
          : rule.mediaId === null),
    )
    .sort(
      (a, b) =>
        Number(b.scope === "MEDIA") - Number(a.scope === "MEDIA") ||
        b.priority - a.priority ||
        compareId(a.id, b.id),
    );
  for (const rule of eligible) {
    const keywords = [...rule.keywords].sort(
      (a, b) =>
        compareId(a.normalizedKeyword, b.normalizedKeyword) ||
        compareId(a.id, b.id),
    );
    for (const keyword of keywords) {
      if (!keyword.normalizedKeyword) continue;
      const matches =
        rule.strategy === "EXACT"
          ? text === keyword.normalizedKeyword
          : containsWholeKeyword(text, keyword.normalizedKeyword);
      if (matches)
        return { kind: "MATCHED", ruleId: rule.id, keywordId: keyword.id };
    }
  }
  return { kind: "SKIPPED", reason: "NO_MATCHING_RULE" };
}
