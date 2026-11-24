import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient, DeliveryState } from "@/generated/prisma/client";
import type {
  InstagramMessagingAdapter,
  MessagingOutcome,
} from "@/modules/instagram/messaging-adapter";
import { decryptDeliveryIntent } from "@/server/db/delivery-intent";
import { encryptCommentText } from "@/server/db/encryption";
import { getDeliverySettings } from "./settings";
import {
  fallbackEligibility,
  DEFAULT_PUBLIC_FALLBACK,
} from "./fallback-policy";
import { verifyControlledTarget, withinReplyWindow } from "./preflight";
import { loadApprovedPreparation } from "./approved-preparation";

const LEASE_MS = 60000;
const MAX_ATTEMPTS = 3;
export async function requireMockDatabase(db: PrismaClient) {
  let url: URL;
  try {
    url = new URL(process.env.TEST_DATABASE_URL ?? "");
  } catch {
    throw new Error("Mock delivery requires isolated local test configuration");
  }
  if (
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/[a-z0-9_]+_test$/.test(url.pathname)
  )
    throw new Error("Mock delivery requires isolated local test configuration");
  const result = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database() AS name`;
  if (result[0]?.name !== url.pathname.slice(1))
    throw new Error("Mock delivery requires the isolated test database");
}
async function markForReview(db: PrismaClient, id: string, code: string) {
  await db.deliveryAction.updateMany({
    where: { id, state: { in: ["PENDING_DELIVERY", "FAILED_RETRYABLE"] } },
    data: { state: "MANUAL_REVIEW", lastErrorCode: code },
  });
  return {
    state: (await db.deliveryAction.findUniqueOrThrow({ where: { id } })).state,
  };
}
// No backfill migration: existing READY intents require an explicit enqueue decision.
export async function enqueueDelivery(db: PrismaClient, executionId: string) {
  const flags = getDeliverySettings();
  if (flags.INSTAGRAM_DELIVERY_MODE === "disabled") return null;
  if (flags.INSTAGRAM_DELIVERY_MODE === "mock") await requireMockDatabase(db);
  const execution = await db.automationExecution.findUniqueOrThrow({
    where: { id: executionId },
    include: {
      event: {
        include: { account: true, comment: { include: { media: true } } },
      },
    },
  });
  if (execution.state !== "READY_FOR_DELIVERY" || !execution.intentCiphertext)
    return null;
  if (
    flags.INSTAGRAM_DELIVERY_MODE === "controlled_test" &&
    (flags.INSTAGRAM_DELIVERY_EXECUTION_ID !== executionId ||
      execution.event.source !== "MANUAL_GET" ||
      flags.INSTAGRAM_DELIVERY_ACCOUNT_ID !==
        execution.event.account.providerId ||
      flags.INSTAGRAM_DELIVERY_COMMENT_ID !==
        execution.event.providerCommentId ||
      flags.INSTAGRAM_DELIVERY_MEDIA_ID !==
        execution.event.comment.media.providerId)
  )
    return null;
  return db.deliveryAction.upsert({
    where: { executionId_kind: { executionId, kind: "PRIVATE_REPLY" } },
    update: {},
    create: {
      executionId,
      kind: "PRIVATE_REPLY",
      mode:
        flags.INSTAGRAM_DELIVERY_MODE === "mock" ? "MOCK" : "CONTROLLED_TEST",
      approvalId:
        flags.INSTAGRAM_DELIVERY_MODE === "mock"
          ? null
          : flags.INSTAGRAM_DELIVERY_APPROVAL_ID,
      approvedUntil:
        flags.INSTAGRAM_DELIVERY_MODE === "mock"
          ? null
          : new Date(flags.INSTAGRAM_DELIVERY_APPROVED_UNTIL!),
    },
  });
}
export async function recoverExpiredSends(db: PrismaClient, now = new Date()) {
  return db.$transaction(async (tx) => {
    const expired = await tx.$queryRaw<
      Array<{ id: string; activeAttemptId: string }>
    >`SELECT id, "activeAttemptId" FROM "DeliveryAction" WHERE state = 'SENDING' AND "leaseExpiresAt" <= ${now} FOR UPDATE SKIP LOCKED`;
    for (const row of expired) {
      await tx.messageAttempt.update({
        where: { id: row.activeAttemptId },
        data: {
          state: "UNKNOWN_OUTCOME",
          errorCode: "SEND_LEASE_EXPIRED",
          completedAt: now,
        },
      });
      await tx.deliveryAction.update({
        where: { id: row.id },
        data: {
          state: "UNKNOWN_OUTCOME",
          lastErrorCode: "SEND_LEASE_EXPIRED",
          activeAttemptId: null,
          leaseExpiresAt: null,
        },
      });
    }
    return expired.length;
  });
}

export async function processDelivery(
  db: PrismaClient,
  actionId: string,
  key: string,
  adapter: InstagramMessagingAdapter,
  now = new Date(),
): Promise<{ state: DeliveryState | "DISABLED" | "DEFERRED" }> {
  let flags;
  try {
    flags = getDeliverySettings();
  } catch {
    return { state: "DISABLED" };
  }
  if (flags.INSTAGRAM_DELIVERY_MODE === "disabled")
    return { state: "DISABLED" };
  if (flags.INSTAGRAM_DELIVERY_MODE === "mock") await requireMockDatabase(db);
  const row = await db.deliveryAction.findUnique({
    where: { id: actionId },
    include: {
      execution: {
        include: {
          selectedRule: true,
          event: {
            include: { account: true, comment: { include: { media: true } } },
          },
        },
      },
    },
  });
  if (!row) return { state: "DEFERRED" };
  const mode =
    flags.INSTAGRAM_DELIVERY_MODE === "mock" ? "MOCK" : "CONTROLLED_TEST";
  if (
    row.mode !== mode ||
    adapter.transport !== (mode === "MOCK" ? "MOCK" : "META")
  )
    return { state: "DISABLED" };
  if (mode === "CONTROLLED_TEST" && row.execution.event.source !== "MANUAL_GET")
    return markForReview(db, row.id, "MANUAL_GET_REQUIRED");
  let approvedPreparation;
  if (mode === "CONTROLLED_TEST") {
    try {
      approvedPreparation = await loadApprovedPreparation(db, key, flags);
    } catch {
      return markForReview(db, row.id, "PREPARATION_NOT_VERIFIED");
    }
  }
  // Recovery is deliberately at-most-one uncertain write, never resend after a crash.
  if (row.state === "SENDING") {
    await recoverExpiredSends(db, now);
    return {
      state: (
        await db.deliveryAction.findUniqueOrThrow({ where: { id: row.id } })
      ).state,
    };
  }
  if (!["PENDING_DELIVERY", "FAILED_RETRYABLE"].includes(row.state))
    return { state: row.state };
  if (mode === "CONTROLLED_TEST" && row.attempts !== 0)
    return markForReview(db, row.id, "ONE_ATTEMPT_ONLY");
  if (row.nextAttemptAt > now) return { state: "DEFERRED" };
  const execution = row.execution;
  const rule = execution.selectedRule;
  let intent;
  try {
    if (!execution.intentCiphertext || execution.state !== "READY_FOR_DELIVERY")
      throw new Error();
    intent = decryptDeliveryIntent(
      execution.id,
      execution.intentCiphertext,
      key,
    );
  } catch {
    return markForReview(db, row.id, "INVALID_DELIVERY_INTENT");
  }
  const authorized =
    rule?.enabled &&
    rule.updatedAt.getTime() === execution.selectedRuleUpdatedAt?.getTime() &&
    intent.accountId === execution.event.account.providerId &&
    intent.commentId === execution.event.providerCommentId;
  const scopeMatches =
    mode === "MOCK" ||
    (flags.INSTAGRAM_DELIVERY_EXECUTION_ID === execution.id &&
      flags.INSTAGRAM_DELIVERY_ACCOUNT_ID === intent.accountId &&
      flags.INSTAGRAM_DELIVERY_COMMENT_ID === intent.commentId &&
      flags.INSTAGRAM_DELIVERY_MEDIA_ID ===
        execution.event.comment.media.providerId &&
      row.approvalId === flags.INSTAGRAM_DELIVERY_APPROVAL_ID &&
      row.approvedUntil &&
      row.approvedUntil > new Date() &&
      row.approvedUntil.toISOString() ===
        new Date(flags.INSTAGRAM_DELIVERY_APPROVED_UNTIL!).toISOString());
  if (!authorized || !scopeMatches) {
    return markForReview(db, row.id, "AUTHORIZATION_CHANGED");
  }
  if (row.kind === "PUBLIC_FALLBACK") {
    const evidence = row.rejectionEvidenceId
      ? await db.messageAttempt.findUnique({
          where: { id: row.rejectionEvidenceId },
          include: { action: true },
        })
      : null;
    if (
      !rule!.publicFallbackEnabled ||
      flags.INSTAGRAM_PUBLIC_FALLBACK_ENABLED !== "1" ||
      mode !== "MOCK" ||
      !evidence ||
      evidence.state !== "FALLBACK_ELIGIBLE" ||
      evidence.errorCode !== "SYNTHETIC_TEST_ONLY" ||
      evidence.action.executionId !== execution.id ||
      evidence.action.kind !== "PRIVATE_REPLY" ||
      evidence.action.mode !== "MOCK"
    ) {
      return markForReview(db, row.id, "FALLBACK_NOT_AUTHORIZED");
    }
  }
  let verified: Awaited<ReturnType<typeof verifyControlledTarget>> | undefined;
  if (mode === "CONTROLLED_TEST") {
    try {
      verified = await verifyControlledTarget(
        flags,
        fetch,
        approvedPreparation!.commenter,
      );
      if (
        verified.createdAt.toISOString() !==
          approvedPreparation!.commentCreatedAt ||
        verified.product !== approvedPreparation!.mediaProduct
      )
        throw new Error("Reviewed comment changed");
    } catch {
      return markForReview(db, row.id, "PREFLIGHT_NOT_VERIFIED");
    }
  }
  const attemptId = randomUUID();
  const claimed = await db.$transaction(async (tx) => {
    // Lock the execution/rule to order claims against configuration edits and duplicate workers.
    await tx.$queryRaw`SELECT id FROM "ProcessingExecution" WHERE id = ${execution.id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "AutomationRule" WHERE id = ${rule!.id}::uuid FOR SHARE`;
    const currentRule = await tx.automationRule.findUnique({
      where: { id: rule!.id },
    });
    if (
      !currentRule?.enabled ||
      currentRule.updatedAt.getTime() !==
        execution.selectedRuleUpdatedAt?.getTime()
    )
      return false;
    if (
      verified &&
      (!withinReplyWindow(verified.createdAt, verified.product) ||
        Date.now() - verified.verifiedAt.getTime() > 30000)
    )
      return false;
    const current = getDeliverySettings();
    if (
      current.INSTAGRAM_DELIVERY_MODE !== flags.INSTAGRAM_DELIVERY_MODE ||
      (mode === "CONTROLLED_TEST" &&
        current.INSTAGRAM_DELIVERY_APPROVAL_ID !== row.approvalId)
    )
      return false;
    const claim = await tx.deliveryAction.updateMany({
      where: {
        id: row.id,
        mode,
        state: { in: ["PENDING_DELIVERY", "FAILED_RETRYABLE"] },
        attempts: { lt: mode === "CONTROLLED_TEST" ? 1 : MAX_ATTEMPTS },
        nextAttemptAt: { lte: now },
      },
      data: {
        state: "SENDING",
        activeAttemptId: attemptId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    if (!claim.count) return false;
    const action = await tx.deliveryAction.findUniqueOrThrow({
      where: { id: row.id },
    });
    await tx.messageAttempt.create({
      data: {
        id: attemptId,
        actionId: row.id,
        number: action.attempts,
        state: "SENDING",
      },
    });
    return true;
  });
  if (!claimed) return { state: "DEFERRED" };
  let outcome: MessagingOutcome;
  try {
    if (mode === "CONTROLLED_TEST")
      await loadApprovedPreparation(db, key, flags);
    const request = {
      accountId: intent.accountId,
      commentId: intent.commentId,
      message:
        row.kind === "PRIVATE_REPLY"
          ? intent.privateMessage
          : (intent.publicFallbackMessage ?? DEFAULT_PUBLIC_FALLBACK),
      idempotencyKey: row.id,
    };
    outcome =
      row.kind === "PRIVATE_REPLY"
        ? await adapter.sendAuthorizedPrivateReply(request)
        : await adapter.sendAuthorizedPublicReply({
            ...request,
            authorization: {
              kind: "CONFIRMED_ELIGIBLE_PRIVATE_REPLY_REJECTION",
              evidenceId: row.rejectionEvidenceId!,
            },
          });
  } catch {
    outcome = { kind: "UNKNOWN", requiresManualReview: true };
  }
  const evidence = fallbackEligibility(outcome, mode);
  let state: DeliveryState, code: string;
  const attempts = row.attempts + 1;
  if (outcome.kind === "API_ACCEPTED") {
    state =
      row.kind === "PRIVATE_REPLY"
        ? "ACCEPTED_BY_META"
        : "FALLBACK_ACCEPTED_BY_META";
    code = "API_ACCEPTED_DELIVERY_UNCONFIRMED";
  } else if (
    evidence &&
    row.kind === "PRIVATE_REPLY" &&
    rule!.publicFallbackEnabled &&
    flags.INSTAGRAM_PUBLIC_FALLBACK_ENABLED === "1"
  ) {
    state = "FALLBACK_ELIGIBLE";
    code = evidence;
  } else if (outcome.kind === "UNKNOWN") {
    state = "UNKNOWN_OUTCOME";
    code = "AMBIGUOUS_WRITE";
  } else if (
    (outcome.kind === "TEMPORARY_FAILURE" ||
      (outcome.kind === "API_REJECTED" &&
        outcome.safeToRetry &&
        outcome.reason === "RATE_LIMIT")) &&
    mode === "MOCK" &&
    attempts < MAX_ATTEMPTS
  ) {
    state = "FAILED_RETRYABLE";
    code = "CONFIRMED_SAFE_RETRY";
  } else {
    state = "FAILED_PERMANENT";
    code =
      outcome.kind === "API_REJECTED"
        ? outcome.reason
        : "RETRIES_EXHAUSTED_OR_INELIGIBLE";
  }
  const finishedAt = new Date();
  // If this commit fails, the durable SENDING attempt remains uncertain and is never resent.
  await db.$transaction(async (tx) => {
    const updated = await tx.deliveryAction.updateMany({
      where: { id: row.id, state: "SENDING", activeAttemptId: attemptId },
      data: {
        state,
        lastErrorCode: code,
        activeAttemptId: null,
        leaseExpiresAt: null,
        operationIdCiphertext:
          outcome.kind === "API_ACCEPTED"
            ? encryptCommentText(
                outcome.operationId,
                key,
                JSON.stringify(["delivery.operation.v1", row.id]),
              )
            : null,
        nextAttemptAt: new Date(
          finishedAt.getTime() +
            Math.max(
              60000 * 2 ** (attempts - 1),
              outcome.kind === "API_REJECTED" ||
                outcome.kind === "TEMPORARY_FAILURE"
                ? (outcome.retryAfterMs ?? 0)
                : 0,
            ),
        ),
      },
    });
    if (!updated.count) return;
    await tx.messageAttempt.update({
      where: { id: attemptId },
      data: {
        state,
        errorCode: code,
        completedAt: finishedAt,
        ...(outcome.kind === "API_REJECTED"
          ? {
              httpStatus: outcome.httpStatus,
              metaCode: outcome.metaCode,
              metaSubcode: outcome.metaSubcode,
            }
          : {}),
      },
    });
    if (state === "FALLBACK_ELIGIBLE")
      await tx.deliveryAction.upsert({
        where: {
          executionId_kind: {
            executionId: execution.id,
            kind: "PUBLIC_FALLBACK",
          },
        },
        update: {},
        create: {
          executionId: execution.id,
          kind: "PUBLIC_FALLBACK",
          mode,
          rejectionEvidenceId: attemptId,
        },
      });
  });
  return {
    state: (
      await db.deliveryAction.findUniqueOrThrow({ where: { id: row.id } })
    ).state,
  };
}
