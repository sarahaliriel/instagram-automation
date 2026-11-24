import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createDatabaseClient } from "@/server/db/client";
import { persistComments } from "@/server/db/ingest-comments";
import { createAutomationRule } from "@/server/db/automation-rules";
import { processComment } from "@/server/jobs/process-comment";
import { parseInstagramEvents } from "@/modules/webhooks/comment-events";
import {
  enqueueDelivery,
  processDelivery,
  recoverExpiredSends,
} from "@/server/delivery/processor";
import { runControlledDeliveryTest } from "@/server/delivery/controlled-test";
import { createMockMessagingAdapter } from "@/server/delivery/mock-adapter";
import { runMockDeliveryBatch } from "@/server/delivery/mock-batch";
import { commentFixture, webhookConfig } from "../fixtures/instagram";
import { automationRuleFixture } from "../fixtures/automation-rules";
import {
  recordSyntheticCommentCreation,
  recordSyntheticRuleActivation,
} from "./support/temporal-matching-fixture";
import type { MessagingOutcome } from "@/modules/instagram/messaging-adapter";
import { sealPreparation } from "@/server/meta/reply-preparation";
import {
  requireIsolatedTestDatabaseUrl,
  resetIntegrationFixtures,
} from "./support/database";

const url = requireIsolatedTestDatabaseUrl();
const db = createDatabaseClient(url);
const key = "a".repeat(64);
const future = (ms = 1000) => new Date(Date.now() + ms);
const accepted: MessagingOutcome = {
  kind: "API_ACCEPTED",
  operationId: "synthetic-operation-id",
  delivery: "UNCONFIRMED",
};
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("INSTAGRAM_DELIVERY_MODE", "mock");
  vi.stubEnv("INSTAGRAM_PUBLIC_FALLBACK_ENABLED", "1");
  await resetIntegrationFixtures(db);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$disconnect();
});
async function prepare(fallback = false) {
  const batch = parseInstagramEvents(
    commentFixture(),
    webhookConfig.accountId,
    webhookConfig.appSecret,
  ).comments.map((event) => ({ ...event, text: "FORMULÁRIO" }));
  await persistComments(db, batch, key);
  const account = await db.instagramAccount.findFirstOrThrow();
  const createdRule = await createAutomationRule(
    db,
    automationRuleFixture(account.id, { publicFallbackEnabled: fallback }),
    key,
  );
  const event = await db.webhookEvent.findFirstOrThrow();
  const rule = await recordSyntheticRuleActivation(db, createdRule.id);
  await recordSyntheticCommentCreation(db, event.commentId);
  await processComment(db, event.id, key, future());
  const execution = await db.automationExecution.findFirstOrThrow();
  const action = (await enqueueDelivery(db, execution.id))!;
  return { batch, rule, event, execution, action };
}
describe("durable message actions with isolated mocked Meta", () => {
  it("records acceptance with encrypted operation ID without claiming delivery", async () => {
    const { action } = await prepare();
    expect(
      await processDelivery(
        db,
        action.id,
        key,
        createMockMessagingAdapter(),
        future(),
      ),
    ).toEqual({ state: "ACCEPTED_BY_META" });
    const stored = await db.deliveryAction.findUniqueOrThrow({
      where: { id: action.id },
    });
    expect(stored.operationIdCiphertext).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain("synthetic-private-operation");
    expect((await db.messageAttempt.findFirstOrThrow()).state).toBe(
      "ACCEPTED_BY_META",
    );
    expect((await db.automationExecution.findFirstOrThrow()).state).toBe(
      "READY_FOR_DELIVERY",
    );
  });
  it("preserves one action across duplicate intents and webhooks", async () => {
    const { action, execution, batch, event } = await prepare();
    await persistComments(db, batch, key);
    await processComment(db, event.id, key, future());
    await Promise.all(
      Array.from({ length: 8 }, () => enqueueDelivery(db, execution.id)),
    );
    expect(await db.deliveryAction.count()).toBe(1);
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPrivateReply: vi.fn().mockResolvedValue(accepted),
    };
    await processDelivery(db, action.id, key, adapter, future());
    await processDelivery(db, action.id, key, adapter, future());
    expect(adapter.sendAuthorizedPrivateReply).toHaveBeenCalledTimes(1);
    expect(await db.messageAttempt.count()).toBe(1);
  });
  it("allows only one concurrent worker to submit", async () => {
    const { action } = await prepare();
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPrivateReply: vi.fn().mockResolvedValue(accepted),
    };
    await Promise.all(
      Array.from({ length: 8 }, () =>
        processDelivery(db, action.id, key, adapter, future()),
      ),
    );
    expect(adapter.sendAuthorizedPrivateReply).toHaveBeenCalledTimes(1);
    expect(await db.messageAttempt.count()).toBe(1);
  });
  it.each([
    "AUTHORIZATION",
    "AUTHENTICATION",
    "POLICY",
    "INVALID_INPUT",
    "OTHER",
  ] as const)("never falls back for %s", async (reason) => {
    const { action } = await prepare(true);
    expect(
      await processDelivery(
        db,
        action.id,
        key,
        createMockMessagingAdapter({
          kind: "API_REJECTED",
          reason,
          safeToRetry: false,
        }),
        future(),
      ),
    ).toEqual({ state: "FAILED_PERMANENT" });
    expect(await db.deliveryAction.count()).toBe(1);
  });
  it("retries a confirmed rate rejection safely with backoff and no fallback", async () => {
    const { action } = await prepare(true);
    const adapter = createMockMessagingAdapter({
      kind: "API_REJECTED",
      reason: "RATE_LIMIT",
      safeToRetry: true,
      metaCode: 4,
      httpStatus: 429,
      retryAfterMs: 120000,
    });
    expect(
      await processDelivery(db, action.id, key, adapter, future()),
    ).toEqual({ state: "FAILED_RETRYABLE" });
    expect(await db.deliveryAction.count()).toBe(1);
    expect(
      await processDelivery(
        db,
        action.id,
        key,
        createMockMessagingAdapter(),
        future(),
      ),
    ).toEqual({ state: "DEFERRED" });
    const pending = await db.deliveryAction.findUniqueOrThrow({
      where: { id: action.id },
    });
    expect(
      await processDelivery(
        db,
        action.id,
        key,
        createMockMessagingAdapter(),
        new Date(pending.nextAttemptAt.getTime() + 1),
      ),
    ).toEqual({ state: "ACCEPTED_BY_META" });
    expect(await db.messageAttempt.count()).toBe(2);
  });
  it("retries only a declared not-submitted temporary failure", async () => {
    const { action } = await prepare();
    expect(
      await processDelivery(
        db,
        action.id,
        key,
        createMockMessagingAdapter({
          kind: "TEMPORARY_FAILURE",
          requestOutcome: "NOT_SUBMITTED",
        }),
        future(),
      ),
    ).toEqual({ state: "FAILED_RETRYABLE" });
  });
  it("stops safe retry after the bounded attempt budget", async () => {
    const { action } = await prepare();
    const adapter = createMockMessagingAdapter({
      kind: "API_REJECTED",
      reason: "RATE_LIMIT",
      safeToRetry: true,
    });
    for (let index = 0; index < 3; index++) {
      const current = await db.deliveryAction.findUniqueOrThrow({
        where: { id: action.id },
      });
      await processDelivery(
        db,
        action.id,
        key,
        adapter,
        new Date(current.nextAttemptAt.getTime() + 1000),
      );
    }
    expect(
      (await db.deliveryAction.findUniqueOrThrow({ where: { id: action.id } }))
        .state,
    ).toBe("FAILED_PERMANENT");
    expect(await db.messageAttempt.count()).toBe(3);
  });
  it("never retries unknown outcomes or creates fallback", async () => {
    const { action } = await prepare(true);
    const adapter = {
      ...createMockMessagingAdapter({
        kind: "UNKNOWN",
        requiresManualReview: true,
      }),
      sendAuthorizedPublicReply: vi.fn(),
    };
    expect(
      await processDelivery(db, action.id, key, adapter, future()),
    ).toEqual({ state: "UNKNOWN_OUTCOME" });
    await processDelivery(db, action.id, key, adapter, future(100000));
    expect(await db.messageAttempt.count()).toBe(1);
    expect(await db.deliveryAction.count()).toBe(1);
    expect(adapter.sendAuthorizedPublicReply).not.toHaveBeenCalled();
  });
  it("creates and accepts exactly one fallback using synthetic eligible evidence only", async () => {
    const { action } = await prepare(true);
    await processDelivery(
      db,
      action.id,
      key,
      createMockMessagingAdapter({ kind: "SIMULATED_ELIGIBLE_REJECTION" }),
      future(),
    );
    const fallback = await db.deliveryAction.findFirstOrThrow({
      where: { kind: "PUBLIC_FALLBACK" },
    });
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPublicReply: vi.fn().mockResolvedValue(accepted),
    };
    await Promise.all(
      Array.from({ length: 5 }, () =>
        processDelivery(db, fallback.id, key, adapter, future()),
      ),
    );
    expect(adapter.sendAuthorizedPublicReply).toHaveBeenCalledTimes(1);
    expect(
      adapter.sendAuthorizedPublicReply.mock.calls[0]![0].message,
    ).toContain("FORMULÁRIO");
    expect(
      (
        await db.deliveryAction.findUniqueOrThrow({
          where: { id: fallback.id },
        })
      ).state,
    ).toBe("FALLBACK_ACCEPTED_BY_META");
    expect(await db.deliveryAction.count()).toBe(2);
  });
  it("requires explicit fallback opt-in on both rule and server", async () => {
    const { action } = await prepare(false);
    await processDelivery(
      db,
      action.id,
      key,
      createMockMessagingAdapter({ kind: "SIMULATED_ELIGIBLE_REJECTION" }),
      future(),
    );
    expect(await db.deliveryAction.count()).toBe(1);
  });
  it("cancels a queued fallback when the server flag is disabled", async () => {
    const { action } = await prepare(true);
    await processDelivery(
      db,
      action.id,
      key,
      createMockMessagingAdapter({ kind: "SIMULATED_ELIGIBLE_REJECTION" }),
      future(),
    );
    const fallback = await db.deliveryAction.findFirstOrThrow({
      where: { kind: "PUBLIC_FALLBACK" },
    });
    vi.stubEnv("INSTAGRAM_PUBLIC_FALLBACK_ENABLED", "0");
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPublicReply: vi.fn(),
    };
    expect(
      await processDelivery(db, fallback.id, key, adapter, future()),
    ).toEqual({ state: "MANUAL_REVIEW" });
    expect(adapter.sendAuthorizedPublicReply).not.toHaveBeenCalled();
  });
  it("does not use an edited/disabled rule or corrupt intent", async () => {
    const { action, rule } = await prepare();
    await db.automationRule.update({
      where: { id: rule.id },
      data: { enabled: false },
    });
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPrivateReply: vi.fn(),
    };
    expect(
      await processDelivery(db, action.id, key, adapter, future()),
    ).toEqual({ state: "MANUAL_REVIEW" });
    expect(adapter.sendAuthorizedPrivateReply).not.toHaveBeenCalled();
  });
  it("rejects mismatched adapter transport without an attempt", async () => {
    const { action } = await prepare();
    expect(
      await processDelivery(
        db,
        action.id,
        key,
        { ...createMockMessagingAdapter(), transport: "META" },
        future(),
      ),
    ).toEqual({ state: "DISABLED" });
    expect(await db.messageAttempt.count()).toBe(0);
  });
  it("leaves a restarted SENDING worker uncertain, not retryable", async () => {
    const { action } = await prepare();
    const attemptId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.deliveryAction.update({
        where: { id: action.id },
        data: {
          state: "SENDING",
          attempts: 1,
          activeAttemptId: attemptId,
          leaseExpiresAt: new Date(Date.now() - 1000),
        },
      });
      await tx.messageAttempt.create({
        data: {
          id: attemptId,
          actionId: action.id,
          number: 1,
          state: "SENDING",
        },
      });
    });
    const restarted = createDatabaseClient(url!);
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPrivateReply: vi.fn(),
    };
    try {
      expect(
        await processDelivery(restarted, action.id, key, adapter, future()),
      ).toEqual({ state: "UNKNOWN_OUTCOME" });
    } finally {
      await restarted.$disconnect();
    }
    expect(adapter.sendAuthorizedPrivateReply).not.toHaveBeenCalled();
  });
  it("does not submit if the SENDING claim cannot commit", async () => {
    const { action } = await prepare();
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPrivateReply: vi.fn(),
    };
    await db.$executeRawUnsafe(
      `CREATE FUNCTION phase5b_fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'SENDING' THEN RAISE EXCEPTION 'synthetic claim failure' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER phase5b_fail_claim BEFORE UPDATE ON "DeliveryAction" FOR EACH ROW EXECUTE FUNCTION phase5b_fail_claim()`,
    );
    try {
      await expect(
        processDelivery(db, action.id, key, adapter, future()),
      ).rejects.toBeDefined();
      expect(adapter.sendAuthorizedPrivateReply).not.toHaveBeenCalled();
      expect(await db.messageAttempt.count()).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER phase5b_fail_claim ON "DeliveryAction"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION phase5b_fail_claim()`);
    }
  });
  it("preserves SENDING after a lost completion commit and recovers to unknown", async () => {
    const { action } = await prepare();
    const adapter = {
      ...createMockMessagingAdapter(),
      sendAuthorizedPrivateReply: vi.fn().mockResolvedValue(accepted),
    };
    await db.$executeRawUnsafe(
      `CREATE FUNCTION phase5b_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic completion failure' USING ERRCODE='40001'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER phase5b_fail_completion BEFORE UPDATE ON "MessageAttempt" FOR EACH ROW EXECUTE FUNCTION phase5b_fail_completion()`,
    );
    try {
      await expect(
        processDelivery(db, action.id, key, adapter, future()),
      ).rejects.toBeDefined();
      expect(
        (
          await db.deliveryAction.findUniqueOrThrow({
            where: { id: action.id },
          })
        ).state,
      ).toBe("SENDING");
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER phase5b_fail_completion ON "MessageAttempt"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION phase5b_fail_completion()`);
    }
    await recoverExpiredSends(db, future(120000));
    await processDelivery(db, action.id, key, adapter, future(130000));
    expect(adapter.sendAuthorizedPrivateReply).toHaveBeenCalledTimes(1);
    expect(
      (await db.deliveryAction.findUniqueOrThrow({ where: { id: action.id } }))
        .state,
    ).toBe("UNKNOWN_OUTCOME");
  });
  it("enforces independent database uniqueness and complete lease pairs", async () => {
    const { action, execution } = await prepare();
    await expect(
      db.deliveryAction.create({
        data: {
          executionId: execution.id,
          kind: "PRIVATE_REPLY",
          mode: "MOCK",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      db.deliveryAction.update({
        where: { id: action.id },
        data: { state: "SENDING" },
      }),
    ).rejects.toBeDefined();
  });
  it("forbids resetting unknown or accepted actions to pending in SQL", async () => {
    const { action } = await prepare();
    await processDelivery(
      db,
      action.id,
      key,
      createMockMessagingAdapter({
        kind: "UNKNOWN",
        requiresManualReview: true,
      }),
      future(),
    );
    await expect(
      db.deliveryAction.update({
        where: { id: action.id },
        data: { state: "PENDING_DELIVERY" },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.messageAttempt.create({
        data: { actionId: action.id, number: 2, state: "SENDING" },
      }),
    ).rejects.toBeDefined();
    expect(await db.messageAttempt.count()).toBe(1);
  });
  it.each(["accepted", "expired", "rate_limit", "timeout"] as const)(
    "runs one controlled attempt with mocked %s outcome",
    async (scenario) => {
      const expired = scenario === "expired";
      const { action, execution, event } = await prepare();
      await db.deliveryAction.delete({ where: { id: action.id } });
      await db.webhookEvent.update({
        where: { id: event.id },
        data: { source: "MANUAL_GET", notificationTime: null },
      });
      const approvalId = randomUUID();
      const comment = await db.instagramComment.findFirstOrThrow({
        include: { media: true },
      });
      const rule = await db.automationRule.findUniqueOrThrow({
        where: { id: execution.selectedRuleId! },
      });
      const createdAt = new Date(Date.now() - 1000).toISOString();
      const directory = join(process.cwd(), ".local", "meta-preparations");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const artifact = join(directory, `${execution.id}.enc`);
      const ciphertext = sealPreparation(
        {
          version: 1,
          executionId: execution.id,
          accountId: webhookConfig.accountId,
          mediaId: comment.media.providerId,
          commentId: comment.providerId,
          commentCreatedAt: createdAt,
          mediaProduct: "FEED",
          commenter: "synthetic_commenter",
          businessIntegrationIdentity: "NOT_VERIFIED",
          clientBusinessId: "6",
          configurationId: "5",
          ruleId: rule.id,
          ruleName: rule.name,
          selectedRuleUpdatedAt: rule.updatedAt.toISOString(),
          outgoingMessage: "Synthetic private reply for isolated tests.",
          preparedAt: new Date().toISOString(),
          requiredPermissions: [
            "instagram_basic",
            "instagram_manage_comments",
            "instagram_manage_messages",
          ],
          permissions: "NOT_VERIFIED",
          advancedAccess: "NOT_VERIFIED",
          approval: "NOT_GRANTED",
        },
        key,
      );
      await writeFile(artifact, ciphertext, { flag: "wx", mode: 0o600 });
      try {
        for (const [name, value] of Object.entries({
          INSTAGRAM_DELIVERY_MODE: "controlled_test",
          INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "0",
          INSTAGRAM_DELIVERY_EXECUTION_ID: execution.id,
          INSTAGRAM_DELIVERY_APPROVAL_ID: approvalId,
          INSTAGRAM_DELIVERY_PREPARATION_SHA256: createHash("sha256")
            .update(ciphertext)
            .digest("hex"),
          INSTAGRAM_DELIVERY_APPROVED_UNTIL: new Date(
            Date.now() + 300000,
          ).toISOString(),
          INSTAGRAM_DELIVERY_ACCOUNT_ID: webhookConfig.accountId,
          INSTAGRAM_DELIVERY_COMMENT_ID: comment.providerId,
          INSTAGRAM_DELIVERY_MEDIA_ID: comment.media.providerId,
          INSTAGRAM_DELIVERY_CREDENTIALS_VERIFIED: "1",
          INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED: "1",
          INSTAGRAM_INTEGRATION_MODE: "disabled",
          INSTAGRAM_ACCOUNT_ID: webhookConfig.accountId,
          META_SYSTEM_USER_ACCESS_TOKEN: "synthetic-controlled-token",
          META_LOGIN_CONFIG_ID: "5",
          META_CLIENT_BUSINESS_ID: "6",
        }))
          vi.stubEnv(name, value);
        const fetcher = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(Response.json({ client_business_id: "6" }))
          .mockResolvedValueOnce(
            Response.json({
              data: [
                { id: webhookConfig.accountId, username: "synthetic_account" },
              ],
            }),
          )
          .mockResolvedValueOnce(
            Response.json({ data: [{ id: comment.media.providerId }] }),
          )
          .mockResolvedValueOnce(
            Response.json({
              id: comment.providerId,
              timestamp: expired
                ? new Date(Date.now() - 8 * 86400000).toISOString()
                : createdAt,
              media: {
                id: comment.media.providerId,
                media_product_type: "FEED",
              },
              from: { username: "synthetic_commenter" },
            }),
          )
          .mockImplementationOnce(async () => {
            if (scenario === "timeout") throw new Error("synthetic timeout");
            if (scenario === "rate_limit")
              return Response.json({ error: { code: 4 } }, { status: 429 });
            return Response.json({
              recipient_id: "999",
              message_id: "synthetic-controlled-response",
            });
          });
        vi.stubGlobal("fetch", fetcher);
        expect(await runMockDeliveryBatch(db, key)).toEqual({ processed: 0 });
        expect(await runControlledDeliveryTest(db, key)).toEqual({
          state: expired
            ? "MANUAL_REVIEW"
            : scenario === "timeout"
              ? "UNKNOWN_OUTCOME"
              : scenario === "rate_limit"
                ? "FAILED_PERMANENT"
                : "ACCEPTED_BY_META",
        });
        expect(fetcher).toHaveBeenCalledTimes(expired ? 4 : 5);
        expect(await db.messageAttempt.count()).toBe(expired ? 0 : 1);
        if (!expired) {
          expect(fetcher.mock.calls[4]![1]?.method).toBe("POST");
          await runControlledDeliveryTest(db, key);
          expect(fetcher).toHaveBeenCalledTimes(5);
          expect(await db.messageAttempt.count()).toBe(1);
        }
      } finally {
        await unlink(artifact);
      }
    },
  );
  it("refuses a webhook-origin execution before a controlled action or request", async () => {
    const { action, execution } = await prepare();
    await db.deliveryAction.delete({ where: { id: action.id } });
    for (const [name, value] of Object.entries({
      INSTAGRAM_DELIVERY_MODE: "controlled_test",
      INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "0",
      INSTAGRAM_DELIVERY_EXECUTION_ID: execution.id,
      INSTAGRAM_DELIVERY_APPROVAL_ID: randomUUID(),
      INSTAGRAM_DELIVERY_PREPARATION_SHA256: "a".repeat(64),
      INSTAGRAM_DELIVERY_APPROVED_UNTIL: new Date(
        Date.now() + 300000,
      ).toISOString(),
      INSTAGRAM_DELIVERY_ACCOUNT_ID: webhookConfig.accountId,
      INSTAGRAM_DELIVERY_COMMENT_ID: (
        await db.instagramComment.findFirstOrThrow()
      ).providerId,
      INSTAGRAM_DELIVERY_MEDIA_ID: (await db.instagramMedia.findFirstOrThrow())
        .providerId,
      INSTAGRAM_DELIVERY_CREDENTIALS_VERIFIED: "1",
      INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED: "1",
      INSTAGRAM_INTEGRATION_MODE: "disabled",
      INSTAGRAM_ACCOUNT_ID: webhookConfig.accountId,
      META_SYSTEM_USER_ACCESS_TOKEN: "synthetic-controlled-token",
      META_LOGIN_CONFIG_ID: "5",
      META_CLIENT_BUSINESS_ID: "6",
    }))
      vi.stubEnv(name, value);
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    expect(await enqueueDelivery(db, execution.id)).toBeNull();
    expect(await db.deliveryAction.count()).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("blocks mock configuration that points away from the isolated loopback database", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://synthetic@remote.example/production",
    );
    await expect(runMockDeliveryBatch(db, key)).rejects.toThrow(
      "isolated local test configuration",
    );
    expect(await db.deliveryAction.count()).toBe(0);
  });
  it("scans the durable inbox in mock mode only and remains off by default", async () => {
    const { action } = await prepare();
    await db.deliveryAction.delete({ where: { id: action.id } });
    expect(await runMockDeliveryBatch(db, key)).toEqual({ processed: 1 });
    expect((await db.deliveryAction.findFirstOrThrow()).state).toBe(
      "ACCEPTED_BY_META",
    );
    vi.stubEnv("INSTAGRAM_DELIVERY_MODE", "disabled");
    expect(await runMockDeliveryBatch(db, key)).toEqual({ processed: 0 });
  });
});
