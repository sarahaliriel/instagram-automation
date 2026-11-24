import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  analyzeMatchingConflicts,
  type ConflictRule,
  type MatchingConflict,
} from "@/modules/automations/conflicts";
import { validateLifecycleTransition } from "@/modules/automations/lifecycle";
import { decryptCommentText } from "./encryption";
import {
  AutomationDraftError,
  type VerifiedOwnership,
} from "./automation-drafts";
import { ruleTemplateContext } from "./automation-rules";

type Database = PrismaClient | Prisma.TransactionClient;

export type AutomationReview = Readonly<{
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  revision: number;
  strategy: "EXACT" | "WHOLE_WORD";
  scope: "GLOBAL" | "MEDIA";
  priority: number;
  mediaProviderId: string | null;
  keyword: string;
  privateMessageTemplate: string;
  executionCount: number;
  publicFallbackEnabled: boolean;
  conflicts: readonly MatchingConflict[];
  reviewDigest: string;
}>;

export async function readAutomationDetail(
  database: PrismaClient,
  ruleId: string,
  accountProviderId: string,
) {
  const rule = await database.automationRule.findFirst({
    where: { id: ruleId, account: { providerId: accountProviderId } },
    select: {
      id: true,
      name: true,
      enabled: true,
      archivedAt: true,
      revision: true,
      strategy: true,
      scope: true,
      priority: true,
      publicFallbackEnabled: true,
      media: { select: { providerId: true } },
      keywords: {
        orderBy: [{ normalizedKeyword: "asc" }, { id: "asc" }],
        take: 1,
        select: { originalKeyword: true },
      },
      _count: { select: { executions: true } },
    },
  });
  if (!rule) throw new AutomationDraftError("NOT_FOUND");
  return {
    id: rule.id,
    name: rule.name,
    status: rule.archivedAt
      ? ("ARCHIVED" as const)
      : rule.enabled
        ? ("ACTIVE" as const)
        : ("DRAFT" as const),
    editable: !rule.enabled && !rule.archivedAt && rule._count.executions === 0,
    revision: rule.revision,
    strategy: rule.strategy,
    scope: rule.scope,
    priority: rule.priority,
    mediaProviderId: rule.media?.providerId ?? null,
    keyword: rule.keywords[0]?.originalKeyword ?? "",
    executionCount: rule._count.executions,
    publicFallbackEnabled: rule.publicFallbackEnabled,
  } as const;
}

async function loadReview(
  database: Database,
  ruleId: string,
  encryptionKey: string,
  accountProviderId: string,
): Promise<AutomationReview> {
  const rule = await database.automationRule.findFirst({
    where: { id: ruleId, account: { providerId: accountProviderId } },
    include: {
      account: { select: { providerId: true } },
      media: { select: { id: true, providerId: true } },
      keywords: {
        orderBy: [{ normalizedKeyword: "asc" }, { id: "asc" }],
        select: {
          originalKeyword: true,
          normalizedKeyword: true,
        },
      },
      _count: { select: { executions: true } },
    },
  });
  if (!rule) throw new AutomationDraftError("NOT_FOUND");
  const existing = await database.automationRule.findMany({
    where: {
      id: { not: rule.id },
      accountId: rule.accountId,
      enabled: true,
      archivedAt: null,
      ...(rule.scope === "MEDIA"
        ? {
            OR: [
              { scope: "GLOBAL" as const },
              { scope: "MEDIA" as const, mediaId: rule.mediaId },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      scope: true,
      mediaId: true,
      priority: true,
      revision: true,
      strategy: true,
      keywords: { select: { normalizedKeyword: true } },
    },
  });
  const candidate: ConflictRule = {
    id: rule.id,
    name: rule.name,
    scope: rule.scope,
    mediaId: rule.mediaId,
    priority: rule.priority,
    revision: rule.revision,
    strategy: rule.strategy,
    keywords: rule.keywords.map((keyword) => keyword.normalizedKeyword),
  };
  const conflicts = analyzeMatchingConflicts(
    candidate,
    existing.map((item) => ({
      ...item,
      keywords: item.keywords.map((keyword) => keyword.normalizedKeyword),
    })),
  );
  const privateMessageTemplate = decryptCommentText(
    rule.privateMessageTemplateCiphertext,
    encryptionKey,
    ruleTemplateContext(rule.id, "private"),
  );
  const reviewData = {
    id: rule.id,
    name: rule.name,
    status: rule.archivedAt
      ? ("ARCHIVED" as const)
      : rule.enabled
        ? ("ACTIVE" as const)
        : ("DRAFT" as const),
    revision: rule.revision,
    strategy: rule.strategy,
    scope: rule.scope,
    priority: rule.priority,
    mediaProviderId: rule.media?.providerId ?? null,
    keyword: rule.keywords[0]?.originalKeyword ?? "",
    privateMessageTemplate,
    executionCount: rule._count.executions,
    publicFallbackEnabled: rule.publicFallbackEnabled,
    conflicts,
  };
  return {
    ...reviewData,
    reviewDigest: createReviewDigest(reviewData),
  };
}

function createReviewDigest(
  review: Omit<AutomationReview, "reviewDigest">,
): string {
  return createHash("sha256").update(JSON.stringify(review)).digest("hex");
}

function digestMatches(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function rethrowTransactionConflict(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  )
    throw new AutomationDraftError("CONFLICT");
  throw error;
}

export function reviewAutomationRule(
  database: PrismaClient,
  ruleId: string,
  encryptionKey: string,
  accountProviderId: string,
) {
  return loadReview(database, ruleId, encryptionKey, accountProviderId);
}

export async function activateAutomationRule(
  database: PrismaClient,
  ruleId: string,
  expectedRevision: number,
  expectedReviewDigest: string,
  encryptionKey: string,
  ownership: VerifiedOwnership,
) {
  try {
    return await database.$transaction(
      async (transaction) => {
        const review = await loadReview(
          transaction,
          ruleId,
          encryptionKey,
          ownership.accountProviderId,
        );
        if (review.mediaProviderId !== ownership.mediaProviderId)
          throw new AutomationDraftError("MEDIA_NOT_OWNED");
        if (review.publicFallbackEnabled)
          throw new AutomationDraftError("NOT_ACTIVATABLE");
        const transitionError = validateLifecycleTransition(
          {
            enabled: review.status === "ACTIVE",
            archivedAt: review.status === "ARCHIVED" ? new Date(0) : null,
            revision: review.revision,
          },
          expectedRevision,
          "ACTIVE",
        );
        if (transitionError) throw new AutomationDraftError(transitionError);
        if (!digestMatches(review.reviewDigest, expectedReviewDigest))
          throw new AutomationDraftError("REVIEW_REQUIRED");
        const updated = await transaction.automationRule.updateMany({
          where: {
            id: ruleId,
            account: { providerId: ownership.accountProviderId },
            revision: expectedRevision,
            enabled: false,
            archivedAt: null,
          },
          data: {
            enabled: true,
            activatedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new AutomationDraftError("CONFLICT");
        return { id: ruleId, revision: expectedRevision + 1, enabled: true };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    rethrowTransactionConflict(error);
  }
}

export async function deactivateAutomationRule(
  database: PrismaClient,
  ruleId: string,
  expectedRevision: number,
  expectedReviewDigest: string,
  encryptionKey: string,
  accountProviderId: string,
) {
  try {
    return await database.$transaction(
      async (transaction) => {
        const review = await loadReview(
          transaction,
          ruleId,
          encryptionKey,
          accountProviderId,
        );
        const inFlight =
          (await transaction.deliveryAction.count({
            where: {
              state: "SENDING",
              execution: { selectedRuleId: ruleId },
            },
          })) > 0;
        const transitionError = validateLifecycleTransition(
          {
            enabled: review.status === "ACTIVE",
            archivedAt: review.status === "ARCHIVED" ? new Date(0) : null,
            revision: review.revision,
          },
          expectedRevision,
          "DRAFT",
          inFlight,
        );
        if (transitionError) throw new AutomationDraftError(transitionError);
        if (!digestMatches(review.reviewDigest, expectedReviewDigest))
          throw new AutomationDraftError("REVIEW_REQUIRED");
        const updated = await transaction.automationRule.updateMany({
          where: {
            id: ruleId,
            account: { providerId: accountProviderId },
            revision: expectedRevision,
            enabled: true,
            archivedAt: null,
          },
          data: { enabled: false, revision: { increment: 1 } },
        });
        if (updated.count !== 1) throw new AutomationDraftError("CONFLICT");
        return { id: ruleId, revision: expectedRevision + 1, enabled: false };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    rethrowTransactionConflict(error);
  }
}
