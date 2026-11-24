import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import {
  MATCHING_ENGINE_VERSION,
  matchAutomation,
} from "@/modules/automations/matcher";
import { normalizeKeyword } from "@/modules/automations/normalize";
import { messageTemplateSchema } from "@/modules/automations/rule-schema";
import {
  commentEncryptionContext,
  decryptCommentText,
} from "@/server/db/encryption";
import { encryptDeliveryIntent } from "@/server/db/delivery-intent";
import { ruleTemplateContext } from "@/server/db/automation-rules";
import {
  StoredEventError,
  TemporalEvidencePendingError,
  TemporalEvidenceReviewError,
} from "./retry-policy";
import { isTemporallyEligible } from "@/modules/automations/temporal-eligibility";

type StoredReceipt = Prisma.WebhookEventGetPayload<{
  include: { comment: true; account: true };
}>;
export async function prepareAutomation(
  tx: Prisma.TransactionClient,
  stored: StoredReceipt,
  key: string,
) {
  let text: string | null = null;
  try {
    if (stored.comment.textCiphertext !== null)
      text = decryptCommentText(
        stored.comment.textCiphertext,
        key,
        commentEncryptionContext(
          stored.account.providerId,
          stored.providerCommentId,
        ),
      );
  } catch {
    throw new StoredEventError();
  }
  const rules =
    text === null
      ? []
      : await tx.automationRule.findMany({
          where: {
            accountId: stored.accountId,
            enabled: true,
            OR: [
              { scope: "GLOBAL", mediaId: null },
              { scope: "MEDIA", mediaId: stored.comment.mediaId },
            ],
          },
          include: { keywords: true },
        });
  if (rules.length > 0) {
    if (!stored.comment.providerCreatedAt)
      throw new TemporalEvidencePendingError();
    if (
      !Number.isFinite(stored.comment.providerCreatedAt.getTime()) ||
      !Number.isFinite(stored.createdAt.getTime()) ||
      stored.comment.providerCreatedAt > stored.createdAt ||
      rules.some(
        (rule) =>
          !rule.activatedAt || !Number.isFinite(rule.activatedAt.getTime()),
      )
    )
      throw new TemporalEvidenceReviewError();
  }
  const eligibleRules = rules.filter((rule) =>
    isTemporallyEligible(
      rule.activatedAt,
      stored.comment.providerCreatedAt,
      stored.createdAt,
    ),
  );
  for (const rule of eligibleRules) {
    if (
      !rule.keywords.length ||
      rule.keywords.length > 50 ||
      rule.keywords.some(
        (keyword) =>
          !keyword.originalKeyword.isWellFormed() ||
          normalizeKeyword(keyword.originalKeyword) !==
            keyword.normalizedKeyword ||
          !keyword.normalizedKeyword,
      )
    )
      throw new StoredEventError();
  }
  const decision = matchAutomation(
    { accountId: stored.accountId, mediaId: stored.comment.mediaId, text },
    eligibleRules,
  );
  const id = randomUUID();
  const base = {
    id,
    eventId: stored.id,
    accountId: stored.accountId,
    commentId: stored.commentId,
    engineVersion: MATCHING_ENGINE_VERSION,
  };
  if (decision.kind === "SKIPPED") {
    return {
      state: "SKIPPED" as const,
      temporalIneligible: rules.length > 0 && eligibleRules.length === 0,
      data: { ...base, state: "SKIPPED" as const, reasonCode: decision.reason },
    };
  }
  const winner = eligibleRules.find((rule) => rule.id === decision.ruleId)!;
  const keyword = winner.keywords.find(
    (item) => item.id === decision.keywordId,
  )!;
  try {
    const privateMessage = messageTemplateSchema.parse(
      decryptCommentText(
        winner.privateMessageTemplateCiphertext,
        key,
        ruleTemplateContext(winner.id, "private"),
      ),
    );
    const publicFallbackMessage =
      winner.publicFallbackTemplateCiphertext === null
        ? null
        : messageTemplateSchema.parse(
            decryptCommentText(
              winner.publicFallbackTemplateCiphertext,
              key,
              ruleTemplateContext(winner.id, "fallback"),
            ),
          );
    const intentCiphertext = encryptDeliveryIntent(
      id,
      {
        version: 1,
        engineVersion: MATCHING_ENGINE_VERSION,
        ruleId: winner.id,
        keywordId: keyword.id,
        strategy: winner.strategy,
        scope: winner.scope,
        priority: winner.priority,
        normalizedKeyword: keyword.normalizedKeyword,
        accountId: stored.account.providerId,
        commentId: stored.providerCommentId,
        privateMessage,
        publicFallbackMessage,
      },
      key,
    );
    return {
      state: "READY_FOR_DELIVERY" as const,
      temporalIneligible: false,
      data: {
        ...base,
        state: "READY_FOR_DELIVERY" as const,
        reasonCode: "KEYWORD_MATCH",
        selectedRuleId: winner.id,
        matchedKeywordId: keyword.id,
        selectedRuleUpdatedAt: winner.updatedAt,
        intentCiphertext,
      },
    };
  } catch {
    throw new StoredEventError();
  }
}
