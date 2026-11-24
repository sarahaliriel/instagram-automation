import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@/server/db/client";
import { createAutomationRule } from "@/server/db/automation-rules";
import { persistComments } from "@/server/db/ingest-comments";
import { processComment } from "@/server/jobs/process-comment";
import { automationRuleFixture } from "../fixtures/automation-rules";
import {
  requireIsolatedTestDatabaseUrl,
  resetIntegrationFixtures,
} from "./support/database";

const db = createDatabaseClient(requireIsolatedTestDatabaseUrl());
const key = "a".repeat(64);
const base = Date.now() - 60_000;
const at = (offset: number) => new Date(base + offset);
const event = {
  eventId: "synthetic",
  accountId: "123",
  mediaId: "456",
  commentId: "789",
  notificationTime: 1,
  text: "FORMULÁRIO",
};
beforeAll(async () => {
  await db.$connect();
});
beforeEach(async () => {
  await resetIntegrationFixtures(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("temporal cutoff with durable decisions", () => {
  it.each([
    ["backlog", 20, 10, "SKIPPED"],
    ["eligible", 10, 20, "READY_FOR_DELIVERY"],
    ["inconsistent future creation", 10, 100_000, "UNKNOWN"],
    ["missing activation", null, 20, "UNKNOWN"],
  ] as const)(
    "%s preserves the canonical decision across duplicates and retries",
    async (_name, activation, creation, expected) => {
      await persistComments(db, [event], key);
      const receipt = await db.webhookEvent.findFirstOrThrow();
      const rule = await createAutomationRule(
        db,
        automationRuleFixture(receipt.accountId),
        key,
      );
      await db.automationRule.update({
        where: { id: rule.id },
        data: { activatedAt: activation === null ? null : at(activation) },
      });
      await db.instagramComment.update({
        where: { id: receipt.commentId },
        data: { providerCreatedAt: creation === null ? null : at(creation) },
      });
      expect((await processComment(db, receipt.id, key)).state).toBe(expected);
      const decision = await db.automationExecution.findUnique({
        where: { eventId: receipt.id },
      });
      expect(decision === null).toBe(expected !== "READY_FOR_DELIVERY");
      await persistComments(db, [{ ...event, notificationTime: 999 }], key);
      expect((await processComment(db, receipt.id, key)).state).toBe(expected);
      expect(
        await db.automationExecution.findUnique({
          where: { eventId: receipt.id },
        }),
      ).toEqual(decision);
      expect(await db.deliveryAction.count()).toBe(0);
      expect(await db.messageAttempt.count()).toBe(0);
      expect(
        (await db.webhookEvent.findUniqueOrThrow({ where: { id: receipt.id } }))
          .notificationTime,
      ).toBe(BigInt(1));
    },
  );
  it("retains an event without creation evidence for controlled retry and review", async () => {
    await persistComments(db, [event], key);
    const receipt = await db.webhookEvent.findFirstOrThrow();
    const rule = await createAutomationRule(
      db,
      automationRuleFixture(receipt.accountId),
      key,
    );
    await db.automationRule.update({
      where: { id: rule.id },
      data: { activatedAt: at(10) },
    });
    await expect(processComment(db, receipt.id, key)).rejects.toThrow(
      "Event processing temporarily unavailable",
    );
    const pending = await db.webhookEvent.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    expect(pending).toMatchObject({
      state: "FAILED_RETRYABLE",
      lastErrorCode: "TEMPORAL_EVIDENCE_PENDING",
    });
    expect(await db.automationExecution.count()).toBe(0);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
    expect(
      (
        await db.outboxMessage.findUniqueOrThrow({
          where: { eventId: receipt.id },
        })
      ).state,
    ).not.toBe("COMPLETED");
    await persistComments(db, [{ ...event, notificationTime: 999 }], key);
    expect(
      (await db.webhookEvent.findUniqueOrThrow({ where: { id: receipt.id } }))
        .notificationTime,
    ).toBe(BigInt(1));
    await db.instagramComment.update({
      where: { id: receipt.commentId },
      data: { providerCreatedAt: at(20) },
    });
    expect(
      (await processComment(db, receipt.id, key, new Date(Date.now() + 60_000)))
        .state,
    ).toBe("READY_FOR_DELIVERY");
    expect(await db.automationExecution.count()).toBe(1);
  });
  it("routes exhausted missing evidence to review without execution or delivery", async () => {
    await persistComments(db, [event], key);
    const receipt = await db.webhookEvent.findFirstOrThrow();
    const rule = await createAutomationRule(
      db,
      automationRuleFixture(receipt.accountId),
      key,
    );
    await db.automationRule.update({
      where: { id: rule.id },
      data: { activatedAt: at(10) },
    });
    const start = Date.now() + 1000;
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(
        processComment(db, receipt.id, key, new Date(start + attempt * 60_000)),
      ).rejects.toThrow("Event processing temporarily unavailable");
    }
    expect(
      (await processComment(db, receipt.id, key, new Date(start + 4 * 60_000)))
        .state,
    ).toBe("UNKNOWN");
    expect(
      await db.webhookEvent.findUniqueOrThrow({ where: { id: receipt.id } }),
    ).toMatchObject({ attempts: 5, lastErrorCode: "TEMPORAL_EVIDENCE_REVIEW" });
    expect(await db.automationExecution.count()).toBe(0);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
  });

  it("does not let a retry turn pre-activation backlog into a new execution", async () => {
    await persistComments(db, [event], key);
    const receipt = await db.webhookEvent.findFirstOrThrow();
    const rule = await createAutomationRule(
      db,
      automationRuleFixture(receipt.accountId),
      key,
    );
    await db.automationRule.update({
      where: { id: rule.id },
      data: { activatedAt: at(20) },
    });
    await expect(processComment(db, receipt.id, key)).rejects.toThrow(
      "Event processing temporarily unavailable",
    );
    await persistComments(db, [{ ...event, notificationTime: 999 }], key);
    await db.instagramComment.update({
      where: { id: receipt.commentId },
      data: { providerCreatedAt: at(10) },
    });
    expect(
      (await processComment(db, receipt.id, key, new Date(Date.now() + 60_000)))
        .state,
    ).toBe("SKIPPED");
    expect(await db.automationExecution.count()).toBe(0);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
  });
});
