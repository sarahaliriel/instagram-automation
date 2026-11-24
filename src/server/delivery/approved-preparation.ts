import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { decryptDeliveryIntent } from "@/server/db/delivery-intent";
import { openPreparation } from "@/server/meta/reply-preparation";
import type { DeliverySettings } from "./settings-schema";
import { withinReplyWindow } from "./preflight";

export async function loadApprovedPreparation(
  db: PrismaClient,
  key: string,
  flags: DeliverySettings,
  directory = join(process.cwd(), ".local", "meta-preparations"),
) {
  const executionId = flags.INSTAGRAM_DELIVERY_EXECUTION_ID!;
  const folder = await lstat(directory);
  if (!folder.isDirectory() || (folder.mode & 0o077) !== 0)
    throw new Error("Private preparation directory required");
  const file = await open(
    join(directory, `${executionId}.enc`),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let ciphertext: string;
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 65536)
      throw new Error("Private preparation file required");
    ciphertext = await file.readFile("utf8");
  } finally {
    await file.close();
  }
  const expected = Buffer.from(
    flags.INSTAGRAM_DELIVERY_PREPARATION_SHA256!,
    "hex",
  );
  const actual = createHash("sha256").update(ciphertext).digest();
  if (!timingSafeEqual(expected, actual))
    throw new Error("Preparation digest mismatch");
  const preparation = openPreparation(executionId, ciphertext, key);
  const execution = await db.automationExecution.findUniqueOrThrow({
    where: { id: executionId },
    include: {
      selectedRule: true,
      event: {
        include: { account: true, comment: { include: { media: true } } },
      },
    },
  });
  if (!execution.intentCiphertext) throw new Error("Intent unavailable");
  const intent = decryptDeliveryIntent(
    executionId,
    execution.intentCiphertext,
    key,
  );
  const preparedAt = new Date(preparation.preparedAt);
  if (
    execution.state !== "READY_FOR_DELIVERY" ||
    execution.event.source !== "MANUAL_GET" ||
    !execution.selectedRule?.enabled ||
    execution.selectedRule.updatedAt.getTime() !==
      execution.selectedRuleUpdatedAt?.getTime() ||
    preparation.accountId !== flags.INSTAGRAM_DELIVERY_ACCOUNT_ID ||
    preparation.mediaId !== flags.INSTAGRAM_DELIVERY_MEDIA_ID ||
    preparation.commentId !== flags.INSTAGRAM_DELIVERY_COMMENT_ID ||
    preparation.accountId !== execution.event.account.providerId ||
    preparation.mediaId !== execution.event.comment.media.providerId ||
    preparation.commentId !== execution.event.providerCommentId ||
    preparation.ruleId !== execution.selectedRuleId ||
    preparation.selectedRuleUpdatedAt !==
      execution.selectedRuleUpdatedAt?.toISOString() ||
    preparation.clientBusinessId !== process.env.META_CLIENT_BUSINESS_ID ||
    preparation.configurationId !== process.env.META_LOGIN_CONFIG_ID ||
    preparation.outgoingMessage !== intent.privateMessage ||
    intent.accountId !== preparation.accountId ||
    intent.commentId !== preparation.commentId ||
    intent.ruleId !== preparation.ruleId ||
    intent.publicFallbackMessage !== null ||
    preparation.commenter !== "synthetic_commenter" ||
    preparation.approval !== "NOT_GRANTED" ||
    !Number.isFinite(preparedAt.getTime()) ||
    preparedAt > new Date() ||
    !withinReplyWindow(
      new Date(preparation.commentCreatedAt),
      preparation.mediaProduct,
    )
  )
    throw new Error("Preparation no longer matches controlled target");
  return preparation;
}
