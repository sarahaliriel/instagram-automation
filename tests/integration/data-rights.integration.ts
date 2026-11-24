import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createDatabaseClient } from "@/server/db/client";
import { persistComments } from "@/server/db/ingest-comments";
import { encryptCommentText } from "@/server/db/encryption";
import {
  prepareDataRightsErasure,
  executeDataRightsErasure,
} from "@/server/db/data-rights";
import {
  requireIsolatedTestDatabaseUrl,
  resetIntegrationFixtures,
} from "./support/database";

const url = requireIsolatedTestDatabaseUrl({ rightsTest: true });
const db = createDatabaseClient(url);
const encryptionKey = "b".repeat(64);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const previousFingerprint = process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
const scope = { accountProviderId: "900001", commentProviderId: "800001" };
const other = { accountProviderId: "900002", commentProviderId: "800001" };
const sibling = { accountProviderId: "900001", commentProviderId: "800002" };

function approval(digest: string) {
  const caseId = randomUUID();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const signed = Buffer.from(
    `data-rights-erasure:v1\n${caseId}\n${digest}\n${expiresAt}`,
  );
  return {
    caseId,
    digest,
    expiresAt,
    signature: sign(null, signed, privateKey).toString("base64"),
  };
}

async function seed(target: typeof scope) {
  await persistComments(
    db,
    [
      {
        eventId: `synthetic-${target.accountProviderId}-${target.commentProviderId}`,
        accountId: target.accountProviderId,
        commentId: target.commentProviderId,
        mediaId: "700001",
        notificationTime: 1,
        text: "synthetic-only-comment",
      },
    ],
    encryptionKey,
  );
}

beforeAll(async () => {
  process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256 = createHash("sha256")
    .update(publicPem)
    .digest("hex");
  await db.$connect();
});
beforeEach(async () => {
  await resetIntegrationFixtures(db, { includeDataRights: true });
});
afterAll(async () => {
  if (previousFingerprint === undefined)
    delete process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
  else process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256 = previousFingerprint;
  await db.$disconnect();
});

describe("test-only rights erasure", () => {
  it("deletes only the selected comment graph, preserves other accounts and is idempotent", async () => {
    await seed(scope);
    await seed(other);
    await seed(sibling);
    const comment = await db.instagramComment.findFirstOrThrow({
      where: {
        providerId: scope.commentProviderId,
        account: { providerId: scope.accountProviderId },
      },
    });
    const event = await db.webhookEvent.findFirstOrThrow({
      where: { commentId: comment.id },
    });
    const rule = await db.automationRule.create({
      data: {
        accountId: comment.accountId,
        name: "synthetic-rule",
        strategy: "EXACT",
        scope: "GLOBAL",
        privateMessageTemplateCiphertext: encryptCommentText(
          "synthetic-template",
          encryptionKey,
          "synthetic-rule",
        ),
      },
    });
    const keyword = await db.automationKeyword.create({
      data: {
        ruleId: rule.id,
        originalKeyword: "synthetic",
        normalizedKeyword: "synthetic",
      },
    });
    const execution = await db.automationExecution.create({
      data: {
        eventId: event.id,
        accountId: comment.accountId,
        commentId: comment.id,
        state: "READY_FOR_DELIVERY",
        reasonCode: "SYNTHETIC",
        selectedRuleId: rule.id,
        matchedKeywordId: keyword.id,
        selectedRuleUpdatedAt: rule.updatedAt,
        intentCiphertext: encryptCommentText(
          "synthetic-intent",
          encryptionKey,
          "synthetic-intent",
        ),
      },
    });
    const action = await db.deliveryAction.create({
      data: {
        executionId: execution.id,
        kind: "PRIVATE_REPLY",
        mode: "MOCK",
        state: "PENDING_DELIVERY",
      },
    });
    const attemptId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.deliveryAction.update({
        where: { id: action.id },
        data: {
          state: "SENDING",
          attempts: 1,
          activeAttemptId: attemptId,
          leaseExpiresAt: new Date(Date.now() + 60_000),
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
      await tx.messageAttempt.update({
        where: { id: attemptId },
        data: { state: "FAILED_RETRYABLE", completedAt: new Date() },
      });
      await tx.deliveryAction.update({
        where: { id: action.id },
        data: {
          state: "FAILED_RETRYABLE",
          activeAttemptId: null,
          leaseExpiresAt: null,
        },
      });
    });
    const plan = await prepareDataRightsErasure(db, scope);
    expect(plan.preview).toMatchObject({
      encryptedCommentPresent: true,
      encryptedIntentPresent: true,
      receipts: 1,
      outbox: 1,
      executions: 1,
      actions: 1,
      attempts: 1,
    });
    const signed = approval(plan.digest);
    expect(
      (await executeDataRightsErasure(db, scope, signed, publicPem)).status,
    ).toBe("erased");
    expect(
      (await executeDataRightsErasure(db, scope, signed, publicPem)).status,
    ).toBe("already_erased");
    expect(await db.instagramComment.count()).toBe(2);
    expect(await db.webhookEvent.count()).toBe(2);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.instagramAccount.count()).toBe(2);
  });

  it("denies unsigned, ambiguous and changed plans without deleting data", async () => {
    await seed(scope);
    await expect(
      prepareDataRightsErasure(db, { ...scope, commentProviderId: "" }),
    ).rejects.toThrow("denied");
    const plan = await prepareDataRightsErasure(db, scope);
    const signed = approval(plan.digest);
    await expect(
      executeDataRightsErasure(
        db,
        scope,
        { ...signed, signature: "invalid" },
        publicPem,
      ),
    ).rejects.toThrow("denied");
    await db.webhookEvent.updateMany({
      where: { providerCommentId: scope.commentProviderId },
      data: { state: "FAILED_RETRYABLE" },
    });
    await expect(
      executeDataRightsErasure(db, scope, signed, publicPem),
    ).rejects.toThrow("denied");
    expect(await db.instagramComment.count()).toBe(1);
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it("rejects a valid active lease after preparation", async () => {
    await seed(scope);
    const plan = await prepareDataRightsErasure(db, scope);
    await db.webhookEvent.updateMany({
      where: { providerCommentId: scope.commentProviderId },
      data: {
        state: "PROCESSING",
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(
      await db.webhookEvent.count({
        where: {
          providerCommentId: scope.commentProviderId,
          state: "PROCESSING",
          leaseToken: { not: null },
          leaseExpiresAt: { not: null },
        },
      }),
    ).toBe(1);
    await expect(
      executeDataRightsErasure(db, scope, approval(plan.digest), publicPem),
    ).rejects.toThrow("denied");
    expect(await db.instagramComment.count()).toBe(1);
  });

  it("rejects a changed child count after approval", async () => {
    await seed(scope);
    const plan = await prepareDataRightsErasure(db, scope);
    const event = await db.webhookEvent.findFirstOrThrow({
      where: { providerCommentId: scope.commentProviderId },
    });
    await db.eventTransition.create({
      data: { eventId: event.id, state: "PENDING", code: "SYNTHETIC" },
    });
    await expect(
      executeDataRightsErasure(db, scope, approval(plan.digest), publicPem),
    ).rejects.toThrow("denied");
    expect(await db.instagramComment.count()).toBe(1);
    expect(await db.eventTransition.count()).toBe(2);
  });

  it("allows at most one concurrent erasure for the same approved case", async () => {
    await seed(scope);
    const plan = await prepareDataRightsErasure(db, scope);
    const signed = approval(plan.digest);
    const outcomes = await Promise.allSettled([
      executeDataRightsErasure(db, scope, signed, publicPem),
      executeDataRightsErasure(db, scope, signed, publicPem),
    ]);
    expect(
      outcomes.filter(
        (result) =>
          result.status === "fulfilled" && result.value.status === "erased",
      ),
    ).toHaveLength(1);
    expect(await db.instagramComment.count()).toBe(0);
    expect(
      await db.dataRightsErasure.count({ where: { caseId: signed.caseId } }),
    ).toBe(1);
  });

  it("preserves a newly received sibling event after plan preparation", async () => {
    await seed(scope);
    const plan = await prepareDataRightsErasure(db, scope);
    await seed(sibling);
    expect(
      (
        await executeDataRightsErasure(
          db,
          scope,
          approval(plan.digest),
          publicPem,
        )
      ).status,
    ).toBe("erased");
    expect(await db.instagramComment.count()).toBe(1);
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it("does not report replay success if ingestion recreated the erased comment", async () => {
    await seed(scope);
    const plan = await prepareDataRightsErasure(db, scope);
    const signed = approval(plan.digest);
    await executeDataRightsErasure(db, scope, signed, publicPem);
    await seed(scope);
    await expect(
      executeDataRightsErasure(db, scope, signed, publicPem),
    ).rejects.toThrow("denied");
    expect(await db.instagramComment.count()).toBe(1);
  });

  it("sets up a synthetic fallback evidence reference for cleanup regression", async () => {
    await seed(scope);
    const comment = await db.instagramComment.findFirstOrThrow();
    const event = await db.webhookEvent.findFirstOrThrow();
    const execution = await db.automationExecution.create({
      data: {
        eventId: event.id,
        accountId: comment.accountId,
        commentId: comment.id,
        engineVersion: "legacy-phase4",
        state: "PROCESSED",
        reasonCode: "SYNTHETIC",
      },
    });
    const privateAction = await db.deliveryAction.create({
      data: {
        executionId: execution.id,
        kind: "PRIVATE_REPLY",
        mode: "MOCK",
        state: "PENDING_DELIVERY",
      },
    });
    const attemptId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.deliveryAction.update({
        where: { id: privateAction.id },
        data: {
          state: "SENDING",
          attempts: 1,
          activeAttemptId: attemptId,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
      await tx.messageAttempt.create({
        data: {
          id: attemptId,
          actionId: privateAction.id,
          number: 1,
          state: "SENDING",
        },
      });
      await tx.messageAttempt.update({
        where: { id: attemptId },
        data: { state: "FAILED_PERMANENT", completedAt: new Date() },
      });
      await tx.deliveryAction.update({
        where: { id: privateAction.id },
        data: {
          state: "FALLBACK_ELIGIBLE",
          activeAttemptId: null,
          leaseExpiresAt: null,
        },
      });
    });
    await db.deliveryAction.create({
      data: {
        executionId: execution.id,
        kind: "PUBLIC_FALLBACK",
        mode: "MOCK",
        state: "PENDING_DELIVERY",
        rejectionEvidenceId: attemptId,
      },
    });
    expect(await db.deliveryAction.count()).toBe(2);
  });

  it("cleans the previous synthetic fallback reference before the next test", async () => {
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
  });

  it("rolls back earlier child deletes if a later receipt delete fails", async () => {
    await seed(scope);
    const plan = await prepareDataRightsErasure(db, scope);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION test_rights_rollback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_rights_rollback BEFORE DELETE ON "WebhookEvent" FOR EACH ROW EXECUTE FUNCTION test_rights_rollback()`,
    );
    try {
      await expect(
        executeDataRightsErasure(db, scope, approval(plan.digest), publicPem),
      ).rejects.toThrow();
      expect(await db.instagramComment.count()).toBe(1);
      expect(await db.webhookEvent.count()).toBe(1);
      expect(await db.outboxMessage.count()).toBe(1);
      expect(await db.eventTransition.count()).toBe(1);
      expect(await db.dataRightsErasure.count()).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS test_rights_rollback ON "WebhookEvent"`,
      );
      await db.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_rights_rollback()`,
      );
    }
  });
});
