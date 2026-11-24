import type { AutomationRuleInput } from "@/modules/automations/rule-schema";
export const RULE_IDS = {
  first: "10000000-0000-4000-8000-000000000001",
  second: "10000000-0000-4000-8000-000000000002",
  third: "10000000-0000-4000-8000-000000000003",
};
// Configuration fixtures only. Never seeded into the application database.
export function automationRuleFixture(
  accountId: string,
  overrides: Partial<AutomationRuleInput> = {},
): AutomationRuleInput {
  return {
    accountId,
    name: "Synthetic test rule",
    enabled: true,
    strategy: "EXACT",
    scope: "GLOBAL",
    mediaId: null,
    priority: 0,
    privateMessageTemplate: "Synthetic private reply for isolated tests.",
    publicFallbackTemplate: null,
    keywords: ["FORMULÁRIO"],
    ...overrides,
  };
}
