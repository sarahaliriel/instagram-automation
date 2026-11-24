import "server-only";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { getPersistenceSettings } from "@/server/db/settings";
import { dispatchOutbox } from "./dispatch-outbox";
import { processComment } from "./process-comment";
import { runMockDeliveryBatch } from "@/server/delivery/mock-batch";
import { inngest } from "./inngest";

function enabled() {
  const config = getPersistenceSettings();
  if (config.JOBS_MODE !== "development")
    throw new NonRetriableError("Background processing disabled");
  return config;
}
export const dispatchComments = inngest.createFunction(
  {
    id: "dispatch-comment-outbox",
    triggers: { cron: "* * * * *" },
    retries: 3,
    concurrency: 1,
  },
  async ({ step }) => {
    enabled();
    return step.run("dispatch-pending-comments", async () => {
      try {
        return await dispatchOutbox(getDatabase(), (payload) =>
          inngest.send(payload),
        );
      } catch {
        throw new Error("Outbox dispatch temporarily unavailable");
      }
    });
  },
);
export const processComments = inngest.createFunction(
  {
    id: "process-persisted-comment",
    triggers: { event: "instagram/comment.persisted" },
    retries: 3,
    concurrency: { limit: 5 },
  },
  async ({ event, step }) => {
    const config = enabled();
    const parsed = z.object({ eventId: z.uuid() }).safeParse(event.data);
    if (!parsed.success)
      throw new NonRetriableError("Invalid internal job event");
    return step.run("process-comment-with-delivery-disabled", async () => {
      try {
        return await processComment(
          getDatabase(),
          parsed.data.eventId,
          config.EVENT_ENCRYPTION_KEY!,
        );
      } catch {
        throw new Error("Event processing temporarily unavailable");
      }
    });
  },
);

export const simulateDeliveries = inngest.createFunction(
  {
    id: "simulate-pending-deliveries",
    triggers: { cron: "* * * * *" },
    retries: 0,
    concurrency: 1,
  },
  async ({ step }) => {
    const config = enabled();
    return step.run("simulate-isolated-delivery-ledger", async () => {
      try {
        return await runMockDeliveryBatch(
          getDatabase(),
          config.EVENT_ENCRYPTION_KEY!,
        );
      } catch {
        throw new Error("Delivery simulation unavailable");
      }
    });
  },
);
