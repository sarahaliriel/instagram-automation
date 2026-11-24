import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeKeyword } from "@/modules/automations/normalize";
import {
  parseAutomationRule,
  AutomationRuleValidationError,
} from "@/modules/automations/rule-schema";
import { encryptCommentText } from "./encryption";

export function ruleTemplateContext(
  ruleId: string,
  kind: "private" | "fallback",
) {
  return JSON.stringify(["automation.rule-template.v1", ruleId, kind]);
}
// Privileged server helper, exercised only by isolated fixtures in this phase.
// No route or development seed exposes/invokes it in the application database.
export async function createAutomationRule(
  database: PrismaClient,
  input: unknown,
  encryptionKey: string,
  id: string = randomUUID(),
) {
  const rule = parseAutomationRule(input);
  if (!z.uuid().safeParse(id).success)
    throw new AutomationRuleValidationError();
  id = id.toLowerCase();
  return database.automationRule.create({
    data: {
      id,
      accountId: rule.accountId,
      name: rule.name,
      enabled: rule.enabled,
      strategy: rule.strategy,
      scope: rule.scope,
      mediaId: rule.mediaId,
      priority: rule.priority,
      publicFallbackEnabled: rule.publicFallbackEnabled,
      privateMessageTemplateCiphertext: encryptCommentText(
        rule.privateMessageTemplate,
        encryptionKey,
        ruleTemplateContext(id, "private"),
      ),
      publicFallbackTemplateCiphertext:
        rule.publicFallbackTemplate === null
          ? null
          : encryptCommentText(
              rule.publicFallbackTemplate,
              encryptionKey,
              ruleTemplateContext(id, "fallback"),
            ),
      keywords: {
        create: rule.keywords.map((keyword) => ({
          originalKeyword: keyword,
          normalizedKeyword: normalizeKeyword(keyword),
        })),
      },
    },
    include: { keywords: true },
  });
}
