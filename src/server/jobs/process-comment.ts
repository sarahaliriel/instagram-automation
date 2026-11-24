import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient, EventState } from "@/generated/prisma/client";
import { prepareAutomation } from "./prepare-automation";
import {
  classifyProcessingError,
  LEASE_MS,
  MAX_PROCESSING_ATTEMPTS,
  ProcessingRetryableError,
  retryDelayMs,
  StoredEventError,
  TemporalEvidencePendingError,
  TemporalEvidenceReviewError,
} from "./retry-policy";

export async function processComment(
  database: PrismaClient,
  eventId: string,
  encryptionKey: string,
  now = new Date(),
): Promise<{ state: EventState | "DEFERRED" }> {
  const token = randomUUID();
  const claim = await database.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; attempts: number }>>`
      UPDATE "WebhookEvent" SET state = 'PROCESSING', attempts = attempts + 1,
        "leaseToken" = ${token}::uuid, "leaseExpiresAt" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = ${now}
      WHERE id = ${eventId}::uuid
        AND state IN ('RECEIVED', 'PENDING', 'FAILED_RETRYABLE', 'PROCESSING')
        AND "nextAttemptAt" <= ${now}
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
      RETURNING id, attempts`;
    const row = rows[0];
    if (row)
      await tx.eventTransition.create({
        data: { eventId, state: "PROCESSING" },
      });
    return row;
  });
  if (!claim) {
    const event = await database.webhookEvent.findUnique({
      where: { id: eventId },
      select: { state: true },
    });
    return {
      state:
        event &&
        [
          "PROCESSED",
          "FAILED_PERMANENT",
          "UNKNOWN",
          "SKIPPED",
          "READY_FOR_DELIVERY",
        ].includes(event.state)
          ? event.state
          : "DEFERRED",
    };
  }
  try {
    if (claim.attempts > MAX_PROCESSING_ATTEMPTS) throw new StoredEventError();
    const stored = await database.webhookEvent.findUnique({
      where: { id: eventId },
      include: { comment: true, account: true },
    });
    if (!stored) throw new StoredEventError();
    const completed = await database.$transaction(
      async (tx) => {
        // Lock/fence first. Rule reads and the immutable decision use one snapshot.
        const owned = await tx.webhookEvent.updateMany({
          where: { id: eventId, state: "PROCESSING", leaseToken: token },
          data: { updatedAt: now },
        });
        if (!owned.count) return null;
        const existing = await tx.automationExecution.findUnique({
          where: { commentId: stored.commentId },
        });
        let state: EventState;
        let code: string;
        if (existing) {
          if (existing.eventId !== eventId) throw new StoredEventError();
          state =
            existing.engineVersion === "legacy-phase4"
              ? "PROCESSED"
              : existing.state;
          code = "EXISTING_DECISION_PRESERVED";
        } else {
          const prepared = await prepareAutomation(tx, stored, encryptionKey);
          if (!prepared.temporalIneligible)
            await tx.automationExecution.create({ data: prepared.data });
          state = prepared.state;
          code = prepared.temporalIneligible
            ? "TEMPORALLY_INELIGIBLE"
            : prepared.data.reasonCode;
        }
        await tx.webhookEvent.update({
          where: { id: eventId },
          data: {
            state,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
          },
        });
        await tx.outboxMessage.update({
          where: { eventId },
          data: {
            state: "COMPLETED",
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
          },
        });
        await tx.eventTransition.create({ data: { eventId, state, code } });
        return state;
      },
      { isolationLevel: "RepeatableRead", timeout: 10000 },
    );
    return { state: completed ?? "DEFERRED" };
  } catch (error) {
    const classified = classifyProcessingError(error);
    const temporalPending = error instanceof TemporalEvidencePendingError;
    const temporalReview = error instanceof TemporalEvidenceReviewError;
    const state =
      classified === "FAILED_RETRYABLE" &&
      claim.attempts >= MAX_PROCESSING_ATTEMPTS
        ? temporalPending
          ? "UNKNOWN"
          : "FAILED_PERMANENT"
        : classified;
    const code = temporalPending
      ? state === "UNKNOWN"
        ? "TEMPORAL_EVIDENCE_REVIEW"
        : "TEMPORAL_EVIDENCE_PENDING"
      : temporalReview
        ? "TEMPORAL_EVIDENCE_REVIEW"
        : claim.attempts > MAX_PROCESSING_ATTEMPTS
          ? "RETRIES_EXHAUSTED"
          : classified === "FAILED_RETRYABLE"
            ? state === "FAILED_PERMANENT"
              ? "RETRIES_EXHAUSTED"
              : "DATABASE_TEMPORARY"
            : state === "FAILED_PERMANENT"
              ? "INVALID_STORED_EVENT"
              : "PROCESSING_REQUIRES_REVIEW";
    await database.$transaction(async (tx) => {
      const updated = await tx.webhookEvent.updateMany({
        where: { id: eventId, state: "PROCESSING", leaseToken: token },
        data: {
          state,
          lastErrorCode: code,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(claim.attempts)),
        },
      });
      if (!updated.count) return;
      await tx.eventTransition.create({ data: { eventId, state, code } });
      if (state !== "FAILED_RETRYABLE")
        await tx.outboxMessage.update({
          where: { eventId },
          data: {
            state: "COMPLETED",
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: code,
          },
        });
    });
    if (state === "FAILED_RETRYABLE") throw new ProcessingRetryableError();
    return { state };
  }
}
