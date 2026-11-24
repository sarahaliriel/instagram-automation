import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { createMockMessagingAdapter } from "./mock-adapter";
import { getDeliverySettings } from "./settings";
import {
  enqueueDelivery,
  processDelivery,
  recoverExpiredSends,
  requireMockDatabase,
} from "./processor";
// The durable READY executions/action rows are the inbox. A crash needs no new webhook.
// Controlled/live mode is deliberately never invoked by an automatic job.
export async function runMockDeliveryBatch(db: PrismaClient, key: string) {
  if (getDeliverySettings().INSTAGRAM_DELIVERY_MODE !== "mock")
    return { processed: 0 };
  await requireMockDatabase(db);
  await recoverExpiredSends(db);
  const executions = await db.automationExecution.findMany({
    where: {
      state: "READY_FOR_DELIVERY",
      deliveries: { none: { kind: "PRIVATE_REPLY" } },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  for (const execution of executions) await enqueueDelivery(db, execution.id);
  const actions = await db.deliveryAction.findMany({
    where: {
      mode: "MOCK",
      state: { in: ["PENDING_DELIVERY", "FAILED_RETRYABLE"] },
      nextAttemptAt: { lte: new Date() },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  for (const action of actions)
    await processDelivery(db, action.id, key, createMockMessagingAdapter());
  return { processed: actions.length };
}
