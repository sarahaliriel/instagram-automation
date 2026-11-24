import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  createInstagramClient,
  type InstagramClientOptions,
} from "@/modules/instagram/client";
import { decryptDeliveryIntent } from "@/server/db/delivery-intent";
import { encryptCommentText, decryptCommentText } from "@/server/db/encryption";
import { withinReplyWindow } from "@/server/delivery/preflight";
import { messageTemplateSchema } from "@/modules/automations/rule-schema";
const id = z.string().regex(/^\d{1,64}$/);
const preparationSchema = z
  .object({
    version: z.literal(1),
    executionId: z.uuid(),
    accountId: id,
    mediaId: id,
    commentId: id,
    commentCreatedAt: z.iso.datetime(),
    mediaProduct: z.enum(["FEED", "REELS"]),
    commenter: z.enum(["synthetic_commenter", "synthetic_other"]),
    businessIntegrationIdentity: z.union([id, z.literal("NOT_VERIFIED")]),
    clientBusinessId: id,
    configurationId: id,
    ruleId: z.uuid(),
    ruleName: z.string().max(120),
    selectedRuleUpdatedAt: z.iso.datetime(),
    outgoingMessage: messageTemplateSchema,
    preparedAt: z.iso.datetime(),
    requiredPermissions: z.tuple([
      z.literal("instagram_basic"),
      z.literal("instagram_manage_comments"),
      z.literal("instagram_manage_messages"),
    ]),
    permissions: z.literal("NOT_VERIFIED"),
    advancedAccess: z.literal("NOT_VERIFIED"),
    approval: z.literal("NOT_GRANTED"),
  })
  .strict();
export type ReplyPreparation = z.infer<typeof preparationSchema>;
function context(executionId: string) {
  return JSON.stringify(["instagram.reply-preparation.v1", executionId]);
}
export function sealPreparation(input: ReplyPreparation, key: string) {
  const parsed = preparationSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid reply preparation");
  return encryptCommentText(
    JSON.stringify(parsed.data),
    key,
    context(parsed.data.executionId),
  );
}
export function openPreparation(
  executionId: string,
  ciphertext: string,
  key: string,
): ReplyPreparation {
  try {
    const result = preparationSchema.parse(
      JSON.parse(decryptCommentText(ciphertext, key, context(executionId))),
    );
    if (result.executionId !== executionId) throw new Error();
    return result;
  } catch {
    throw new Error("Reply preparation cannot be opened");
  }
}
export function safePreparationSummary(preparation: ReplyPreparation) {
  return {
    status: "PREPARED_NOT_APPROVED",
    targetIdentity: "MATCHED",
    mediaOwnership: "VERIFIED_ON_FIRST_PAGE",
    commentRead: "VERIFIED",
    replyWindow: "ELIGIBLE_AT_PREPARATION_TIME",
    automation: "ENABLED_UNCHANGED",
    outgoingMessage: "ENCRYPTED_REVIEW_REQUIRED",
    permissions: preparation.permissions,
    advancedAccess: preparation.advancedAccess,
    approval: preparation.approval,
    deliveryActionsCreated: 0,
  };
}
// Explicit selection only. No discovery of follower comments and no import of a sending helper.
export async function prepareReplyReview(
  db: PrismaClient,
  executionId: string,
  input: InstagramClientOptions,
  key: string,
  expectedCommenter: "synthetic_commenter" | "synthetic_other",
  fetcher: typeof fetch = fetch,
  onStage?: (
    stage:
      | "DATABASE_READ"
      | "DATABASE_TRANSACTION"
      | "DATABASE_EXECUTION"
      | "DATABASE_RULE"
      | "DATABASE_DELIVERIES"
      | "DATABASE_EVENT"
      | "DATABASE_ACCOUNT"
      | "DATABASE_COMMENT"
      | "DATABASE_MEDIA"
      | "INTENT_VALIDATION"
      | "META_CLIENT"
      | "META_GET",
  ) => void,
): Promise<ReplyPreparation> {
  if (
    !z
      .enum(["synthetic_commenter", "synthetic_other"])
      .safeParse(expectedCommenter).success
  )
    throw new Error("Explicit owned test account required");
  if (!z.uuid().safeParse(executionId).success)
    throw new Error("Invalid preparation target");
  onStage?.("DATABASE_READ");
  const execution = await db.$transaction(async (tx) => {
    onStage?.("DATABASE_TRANSACTION");
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    onStage?.("DATABASE_EXECUTION");
    const execution = await tx.automationExecution.findUnique({
      where: { id: executionId },
    });
    if (!execution) return null;
    // Sequential reads avoid concurrent queries on one interactive pg transaction.
    onStage?.("DATABASE_RULE");
    const selectedRule = execution.selectedRuleId
      ? await tx.automationRule.findUnique({
          where: { id: execution.selectedRuleId },
        })
      : null;
    onStage?.("DATABASE_DELIVERIES");
    const deliveries = await tx.deliveryAction.findMany({
      where: { executionId },
      select: { id: true },
    });
    onStage?.("DATABASE_EVENT");
    const event = await tx.webhookEvent.findUniqueOrThrow({
      where: { id: execution.eventId },
    });
    onStage?.("DATABASE_ACCOUNT");
    const account = await tx.instagramAccount.findUniqueOrThrow({
      where: { id: event.accountId },
    });
    onStage?.("DATABASE_COMMENT");
    const comment = await tx.instagramComment.findUniqueOrThrow({
      where: { id: event.commentId },
    });
    onStage?.("DATABASE_MEDIA");
    const media = await tx.instagramMedia.findUniqueOrThrow({
      where: { id: comment.mediaId },
    });
    return {
      ...execution,
      selectedRule,
      deliveries,
      event: { ...event, account, comment: { ...comment, media } },
    };
  });
  onStage?.("INTENT_VALIDATION");
  if (!execution) throw new Error("PREPARATION_EXECUTION_MISSING");
  if (execution.event.source !== "MANUAL_GET")
    throw new Error("PREPARATION_SOURCE_MISMATCH");
  if (execution.state !== "READY_FOR_DELIVERY" || !execution.intentCiphertext)
    throw new Error("PREPARATION_INTENT_NOT_READY");
  if (execution.deliveries.length)
    throw new Error("PREPARATION_DELIVERY_EXISTS");
  if (!execution.selectedRule?.enabled)
    throw new Error("PREPARATION_RULE_DISABLED");
  if (
    execution.selectedRule.updatedAt.getTime() !==
    execution.selectedRuleUpdatedAt?.getTime()
  )
    throw new Error("PREPARATION_RULE_CHANGED");
  const intent = decryptDeliveryIntent(
    execution.id,
    execution.intentCiphertext,
    key,
  );
  const mediaId = execution.event.comment.media.providerId;
  if (
    input.accountId !== execution.event.account.providerId ||
    intent.accountId !== input.accountId ||
    intent.commentId !== execution.event.providerCommentId ||
    intent.ruleId !== execution.selectedRuleId ||
    intent.keywordId !== execution.matchedKeywordId
  )
    throw new Error("Preparation target identity mismatch");
  const allowed = new Set([
    `https://graph.facebook.com/${input.apiVersion}/me?fields=client_business_id`,
    `https://graph.facebook.com/${input.apiVersion}/me/assigned_instagram_accounts?fields=id%2Cusername`,
    `https://graph.facebook.com/${input.apiVersion}/${input.accountId}/media`,
    `https://graph.facebook.com/${input.apiVersion}/${intent.commentId}?fields=id%2Ctimestamp%2Cmedia%7Bid%2Cmedia_product_type%7D%2Cfrom`,
  ]);
  const readOnly: typeof fetch = (url, init) => {
    if (init?.method !== "GET" || init.body || !allowed.has(String(url)))
      throw new Error("Preparation request denied");
    return fetcher(url, init);
  };
  onStage?.("META_CLIENT");
  const client = createInstagramClient(input, readOnly);
  onStage?.("META_GET");
  // Some valid Unified Login responses omit /me.id. The portfolio is the
  // authorization boundary for this operation; never invent an identity.
  const business = await client.getClientBusinessPortfolio();
  const account = await client.getAccount();
  if (account.username.toLowerCase() !== "synthetic_account")
    throw new Error("Expected account not verified");
  const media = await client.listMedia();
  if (!media.data.some((item) => item.id === mediaId))
    throw new Error("Selected media not verified on first page");
  const comment = await client.getTestCommentContext(intent.commentId);
  if (comment.from.username.toLowerCase() !== expectedCommenter)
    throw new Error("Test commenter identity not verified");
  const createdAt = new Date(comment.timestamp);
  if (
    comment.id !== intent.commentId ||
    comment.media.id !== mediaId ||
    !withinReplyWindow(createdAt, comment.media.media_product_type)
  )
    throw new Error("Selected comment is not eligible");
  return preparationSchema.parse({
    version: 1,
    executionId,
    accountId: intent.accountId,
    mediaId,
    commentId: intent.commentId,
    commentCreatedAt: createdAt.toISOString(),
    mediaProduct: comment.media.media_product_type,
    commenter: expectedCommenter,
    businessIntegrationIdentity: "NOT_VERIFIED",
    clientBusinessId: business.client_business_id,
    configurationId: input.credential.configId,
    ruleId: execution.selectedRule.id,
    ruleName: execution.selectedRule.name,
    selectedRuleUpdatedAt: execution.selectedRule.updatedAt.toISOString(),
    outgoingMessage: intent.privateMessage,
    preparedAt: new Date().toISOString(),
    requiredPermissions: [
      "instagram_basic",
      "instagram_manage_comments",
      "instagram_manage_messages",
    ],
    permissions: "NOT_VERIFIED",
    advancedAccess: "NOT_VERIFIED",
    approval: "NOT_GRANTED",
  });
}
export function privateReviewText(preparation: ReplyPreparation) {
  // Credentials are excluded by the strict manifest schema; this string is GUI-only, never logged.
  return [
    "PREPARAÇÃO APENAS — NÃO AUTORIZA ENVIO",
    `Conta: ${preparation.accountId}`,
    `Conta de teste confirmada: @${preparation.commenter}`,
    `Publicação: ${preparation.mediaId}`,
    `Comentário: ${preparation.commentId}`,
    `Criado em: ${preparation.commentCreatedAt}`,
    `Automação: ${preparation.ruleName} (${preparation.ruleId})`,
    `Execução: ${preparation.executionId}`,
    `Mensagem exata:\n${preparation.outgoingMessage}`,
    `Permissões necessárias: ${preparation.requiredPermissions.join(", ")}`,
    "Permissões/Advanced Access: por verificar",
    `Preflight realizado em: ${preparation.preparedAt}`,
    "É necessária nova verificação e aprovação explícita antes de qualquer envio.",
  ].join("\n\n");
}
