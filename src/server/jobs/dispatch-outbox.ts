import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { LEASE_MS, REDISPATCH_MS, retryDelayMs } from "./retry-policy";

export type DispatchPayload = {
  id: string;
  name: "instagram/comment.persisted";
  data: { eventId: string };
};
export type SendJob = (payload: DispatchPayload) => Promise<unknown>;

export async function dispatchOutbox(
  database: PrismaClient,
  send: SendJob,
  limit = 20,
  now = new Date(),
) {
  let dispatched = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(Math.max(limit, 0), 100); index++) {
    const token = randomUUID();
    const claimed = await database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; eventId: string; attempts: number }>
      >`
        SELECT o.id, o."eventId", o.attempts FROM "OutboxMessage" o
        JOIN "WebhookEvent" e ON e.id = o."eventId"
        WHERE o.state <> 'COMPLETED' AND o."nextAttemptAt" <= ${now}
          AND (o."leaseExpiresAt" IS NULL OR o."leaseExpiresAt" <= ${now})
          AND e.state IN ('RECEIVED', 'PENDING', 'FAILED_RETRYABLE', 'PROCESSING')
          AND e."nextAttemptAt" <= ${now}
          AND (e."leaseExpiresAt" IS NULL OR e."leaseExpiresAt" <= ${now})
        ORDER BY o."createdAt", o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1`;
      const row = rows[0];
      if (!row) return null;
      await tx.outboxMessage.update({
        where: { id: row.id },
        data: {
          state: "LEASED",
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          nextAttemptAt: new Date(now.getTime() + LEASE_MS),
          attempts: { increment: 1 },
        },
      });
      const pending = await tx.webhookEvent.updateMany({
        where: { id: row.eventId, state: "RECEIVED" },
        data: { state: "PENDING" },
      });
      if (pending.count)
        await tx.eventTransition.create({
          data: { eventId: row.eventId, state: "PENDING" },
        });
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!claimed) break;
    try {
      // A new dispatch generation permits recovery beyond provider dedup windows.
      // Database fencing and unique executions remain the reliability boundary.
      await send({
        id: `${claimed.id}:${claimed.attempts}`,
        name: "instagram/comment.persisted",
        data: { eventId: claimed.eventId },
      });
      await database.outboxMessage.updateMany({
        where: { id: claimed.id, leaseToken: token, state: "LEASED" },
        data: {
          state: "DISPATCHED",
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(now.getTime() + REDISPATCH_MS),
          lastErrorCode: null,
        },
      });
      dispatched++;
    } catch {
      // Dispatch is at-least-once; even a lost response can safely be redispatched.
      await database.outboxMessage.updateMany({
        where: { id: claimed.id, leaseToken: token, state: "LEASED" },
        data: {
          state: "PENDING",
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(
            now.getTime() + retryDelayMs(claimed.attempts),
          ),
          lastErrorCode: "DISPATCH_UNAVAILABLE",
        },
      });
      failed++;
    }
  }
  return { dispatched, failed };
}
