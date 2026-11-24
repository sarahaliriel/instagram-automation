import { matchAutomation, type MatchingRule } from "./matcher";

export type ConflictRule = Readonly<{
  id: string;
  name: string;
  scope: "GLOBAL" | "MEDIA";
  mediaId: string | null;
  priority: number;
  revision: number;
  strategy: "EXACT" | "WHOLE_WORD";
  keywords: readonly string[];
}>;

export type MatchingConflict = Readonly<{
  ruleId: string;
  name: string;
  scope: "GLOBAL" | "MEDIA";
  priority: number;
  revision: number;
  overlappingKeywords: readonly string[];
  precedence: "CANDIDATE_WINS" | "EXISTING_RULE_WINS";
}>;

function compareId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrecedence(a: ConflictRule, b: ConflictRule) {
  return (
    Number(b.scope === "MEDIA") - Number(a.scope === "MEDIA") ||
    b.priority - a.priority ||
    compareId(a.id, b.id)
  );
}

function asMatchingRule(rule: ConflictRule): MatchingRule {
  return {
    id: rule.id,
    accountId: "conflict-review",
    enabled: true,
    strategy: rule.strategy,
    scope: rule.scope,
    mediaId: rule.mediaId,
    priority: rule.priority,
    keywords: rule.keywords.map((normalizedKeyword, index) => ({
      id: `${rule.id}:${index}`,
      normalizedKeyword,
    })),
  };
}

function bothMatch(text: string, a: ConflictRule, b: ConflictRule) {
  const mediaId = a.mediaId ?? b.mediaId ?? "global-media";
  return [a, b].every(
    (rule) =>
      matchAutomation({ accountId: "conflict-review", mediaId, text }, [
        asMatchingRule(rule),
      ]).kind === "MATCHED",
  );
}

function findOverlapExamples(a: ConflictRule, b: ConflictRule) {
  const examples = new Set<string>();
  for (const first of a.keywords)
    for (const second of b.keywords)
      for (const text of [first, second, `${first} ${second}`])
        if (bothMatch(text, a, b)) examples.add(`${first} ↔ ${second}`);
  return [...examples].sort();
}

export function analyzeMatchingConflicts(
  candidate: ConflictRule,
  existingRules: readonly ConflictRule[],
): MatchingConflict[] {
  return existingRules
    .filter(
      (rule) =>
        rule.id !== candidate.id &&
        (candidate.scope === "GLOBAL" ||
          rule.scope === "GLOBAL" ||
          (rule.scope === "MEDIA" && rule.mediaId === candidate.mediaId)),
    )
    .flatMap((rule) => {
      const overlappingKeywords = findOverlapExamples(candidate, rule);
      if (!overlappingKeywords.length) return [];
      return [
        {
          ruleId: rule.id,
          name: rule.name,
          scope: rule.scope,
          priority: rule.priority,
          revision: rule.revision,
          overlappingKeywords,
          precedence:
            comparePrecedence(candidate, rule) <= 0
              ? ("CANDIDATE_WINS" as const)
              : ("EXISTING_RULE_WINS" as const),
        },
      ];
    })
    .sort((a, b) => compareId(a.ruleId, b.ruleId));
}
