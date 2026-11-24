import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  automationDraftSchema,
  type AutomationDraftInput,
} from "@/modules/automations/rule-schema";
import { normalizeKeyword } from "@/modules/automations/normalize";
import { decryptCommentText, encryptCommentText } from "./encryption";
import { ruleTemplateContext } from "./automation-rules";

export type AutomationDraftErrorCode =
  | "INVALID_INPUT"
  | "ACCOUNT_NOT_FOUND"
  | "MEDIA_NOT_OWNED"
  | "NOT_FOUND"
  | "NOT_EDITABLE"
  | "CONFLICT"
  | "NOT_ACTIVATABLE"
  | "NOT_DEACTIVATABLE"
  | "DELIVERY_IN_FLIGHT"
  | "REVIEW_REQUIRED";

export class AutomationDraftError extends Error {
  constructor(public readonly code: AutomationDraftErrorCode) {
    super(`Automation draft operation failed (${code}).`);
    this.name = "AutomationDraftError";
  }
}

export type VerifiedOwnership = Readonly<{
  accountProviderId: string;
  mediaProviderId: string;
}>;

function parseDraft(input: unknown) {
  const result = automationDraftSchema.safeParse(input);
  if (!result.success) throw new AutomationDraftError("INVALID_INPUT");
  return result.data;
}

async function resolveOwnedMedia(
  transaction: Prisma.TransactionClient,
  ownership: VerifiedOwnership,
) {
  const account = await transaction.instagramAccount.findUnique({
    where: {
      provider_providerId: {
        provider: "INSTAGRAM",
        providerId: ownership.accountProviderId,
      },
    },
    select: { id: true },
  });
  if (!account) throw new AutomationDraftError("ACCOUNT_NOT_FOUND");
  const media = await transaction.instagramMedia.findUnique({
    where: {
      accountId_providerId: {
        accountId: account.id,
        providerId: ownership.mediaProviderId,
      },
    },
    select: { id: true, accountId: true },
  });
  if (!media || media.accountId !== account.id)
    throw new AutomationDraftError("MEDIA_NOT_OWNED");
  return { accountId: account.id, mediaId: media.id };
}

export async function createAutomationDraft(
  database: PrismaClient,
  input: AutomationDraftInput,
  encryptionKey: string,
  ownership: VerifiedOwnership,
  id: string = randomUUID(),
) {
  const draft = parseDraft(input);
  if (draft.mediaProviderId !== ownership.mediaProviderId)
    throw new AutomationDraftError("MEDIA_NOT_OWNED");
  return database.$transaction(async (transaction) => {
    const target = await resolveOwnedMedia(transaction, ownership);
    return transaction.automationRule.create({
      data: {
        id,
        accountId: target.accountId,
        name: draft.name,
        enabled: false,
        strategy: draft.strategy,
        scope: "MEDIA",
        mediaId: target.mediaId,
        priority: 0,
        publicFallbackEnabled: false,
        privateMessageTemplateCiphertext: encryptCommentText(
          draft.privateMessageTemplate,
          encryptionKey,
          ruleTemplateContext(id, "private"),
        ),
        keywords: {
          create: {
            originalKeyword: draft.keyword,
            normalizedKeyword: normalizeKeyword(draft.keyword),
          },
        },
      },
      select: { id: true, revision: true, enabled: true, archivedAt: true },
    });
  });
}

export async function updateAutomationDraft(
  database: PrismaClient,
  ruleId: string,
  expectedRevision: number,
  input: AutomationDraftInput,
  encryptionKey: string,
  ownership: VerifiedOwnership,
) {
  const draft = parseDraft(input);
  if (draft.mediaProviderId !== ownership.mediaProviderId)
    throw new AutomationDraftError("MEDIA_NOT_OWNED");
  return database.$transaction(async (transaction) => {
    const existing = await transaction.automationRule.findFirst({
      where: {
        id: ruleId,
        account: { providerId: ownership.accountProviderId },
      },
      select: {
        id: true,
        enabled: true,
        archivedAt: true,
        revision: true,
        _count: { select: { executions: true } },
      },
    });
    if (!existing) throw new AutomationDraftError("NOT_FOUND");
    if (existing.enabled || existing.archivedAt || existing._count.executions)
      throw new AutomationDraftError("NOT_EDITABLE");
    if (existing.revision !== expectedRevision)
      throw new AutomationDraftError("CONFLICT");
    const target = await resolveOwnedMedia(transaction, ownership);
    const updated = await transaction.automationRule.updateMany({
      where: {
        id: ruleId,
        revision: expectedRevision,
        enabled: false,
        archivedAt: null,
        account: { providerId: ownership.accountProviderId },
      },
      data: {
        name: draft.name,
        strategy: draft.strategy,
        scope: "MEDIA",
        mediaId: target.mediaId,
        privateMessageTemplateCiphertext: encryptCommentText(
          draft.privateMessageTemplate,
          encryptionKey,
          ruleTemplateContext(ruleId, "private"),
        ),
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new AutomationDraftError("CONFLICT");
    await transaction.automationKeyword.deleteMany({ where: { ruleId } });
    await transaction.automationKeyword.create({
      data: {
        ruleId,
        originalKeyword: draft.keyword,
        normalizedKeyword: normalizeKeyword(draft.keyword),
      },
    });
    return { id: ruleId, revision: expectedRevision + 1 };
  });
}

export async function archiveAutomationRule(
  database: PrismaClient,
  ruleId: string,
  expectedRevision: number,
  accountProviderId: string,
  now = new Date(),
) {
  const updated = await database.automationRule.updateMany({
    where: {
      id: ruleId,
      revision: expectedRevision,
      enabled: false,
      archivedAt: null,
      account: { providerId: accountProviderId },
    },
    data: {
      enabled: false,
      archivedAt: now,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    const exists = await database.automationRule.count({
      where: { id: ruleId, account: { providerId: accountProviderId } },
    });
    throw new AutomationDraftError(exists ? "CONFLICT" : "NOT_FOUND");
  }
  return { id: ruleId, revision: expectedRevision + 1, archivedAt: now };
}

export async function readPrivateAutomationDraft(
  database: PrismaClient,
  ruleId: string,
  encryptionKey: string,
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
      media: { select: { providerId: true } },
      keywords: {
        orderBy: { normalizedKeyword: "asc" },
        take: 1,
        select: { originalKeyword: true },
      },
      privateMessageTemplateCiphertext: true,
      _count: { select: { executions: true } },
    },
  });
  if (!rule) throw new AutomationDraftError("NOT_FOUND");
  return {
    id: rule.id,
    name: rule.name,
    status: rule.archivedAt ? "ARCHIVED" : rule.enabled ? "ACTIVE" : "DRAFT",
    editable: !rule.enabled && !rule.archivedAt && rule._count.executions === 0,
    revision: rule.revision,
    strategy: rule.strategy,
    mediaProviderId: rule.media?.providerId ?? null,
    keyword: rule.keywords[0]?.originalKeyword ?? "",
    privateMessageTemplate: decryptCommentText(
      rule.privateMessageTemplateCiphertext,
      encryptionKey,
      ruleTemplateContext(rule.id, "private"),
    ),
    executionCount: rule._count.executions,
  } as const;
}
