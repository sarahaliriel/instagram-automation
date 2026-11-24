import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseClient } from "@/server/db/client";
import { persistComments } from "@/server/db/ingest-comments";
import { createAutomationRule } from "@/server/db/automation-rules";
import { processComment } from "@/server/jobs/process-comment";
import { prepareReplyReview } from "@/server/meta/reply-preparation";
import { parseInstagramEvents } from "@/modules/webhooks/comment-events";
import { commentFixture, webhookConfig } from "../fixtures/instagram";
import { automationRuleFixture } from "../fixtures/automation-rules";
import {
  recordSyntheticCommentCreation,
  recordSyntheticRuleActivation,
} from "./support/temporal-matching-fixture";
import {
  requireIsolatedTestDatabaseUrl,
  resetIntegrationFixtures,
} from "./support/database";
const url = requireIsolatedTestDatabaseUrl();
const db = createDatabaseClient(url),
  key = "a".repeat(64);
const options = {
  apiVersion: "v27.0" as const,
  accountId: webhookConfig.accountId,
  credential: {
    kind: "business_integration_system_user" as const,
    accessToken: "synthetic-only-token",
    configId: "5",
    clientBusinessId: "6",
  },
};
beforeEach(async () => {
  await resetIntegrationFixtures(db);
});
afterAll(() => db.$disconnect());
async function target() {
  const events = parseInstagramEvents(
    commentFixture(),
    webhookConfig.accountId,
    webhookConfig.appSecret,
  ).comments.map((event) => ({ ...event, text: "FORMULÁRIO" }));
  await persistComments(db, events, key);
  const account = await db.instagramAccount.findFirstOrThrow();
  const createdRule = await createAutomationRule(
    db,
    automationRuleFixture(account.id),
    key,
  );
  const receipt = await db.webhookEvent.findFirstOrThrow();
  const rule = await recordSyntheticRuleActivation(db, createdRule.id);
  await recordSyntheticCommentCreation(db, receipt.commentId);
  await db.webhookEvent.update({
    where: { id: receipt.id },
    data: { source: "MANUAL_GET", notificationTime: null },
  });
  await processComment(db, receipt.id, key, new Date(Date.now() + 1000));
  return {
    rule,
    execution: await db.automationExecution.findFirstOrThrow(),
    event: events[0]!,
  };
}
function reads(
  commentId: string,
  mediaId: string,
  username = "synthetic_account",
  age = 1000,
) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ client_business_id: "6" }))
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: webhookConfig.accountId, username }] }),
    )
    .mockResolvedValueOnce(Response.json({ data: [{ id: mediaId }] }))
    .mockResolvedValueOnce(
      Response.json({
        id: commentId,
        timestamp: new Date(Date.now() - age).toISOString(),
        media: { id: mediaId, media_product_type: "FEED" },
        from: { username: "synthetic_commenter" },
      }),
    );
}
describe("read-only selected-comment preparation", () => {
  it("reads a real persisted intent without creating/updating execution, actions or attempts", async () => {
    const { execution, event, rule } = await target();
    const fetcher = reads(event.commentId, event.mediaId);
    const prepared = await prepareReplyReview(
      db,
      execution.id,
      options,
      key,
      "synthetic_commenter",
      fetcher,
    );
    expect(prepared).toMatchObject({
      executionId: execution.id,
      accountId: event.accountId,
      mediaId: event.mediaId,
      commentId: event.commentId,
      ruleId: rule.id,
      approval: "NOT_GRANTED",
      permissions: "NOT_VERIFIED",
    });
    expect(prepared.outgoingMessage).toBe(
      "Synthetic private reply for isolated tests.",
    );
    expect(
      await db.automationExecution.findUniqueOrThrow({
        where: { id: execution.id },
      }),
    ).toEqual(execution);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetcher.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(String(url)).not.toContain(options.credential.accessToken);
    }
  });
  it("does not pick a comment or invent an execution when selection is missing", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      prepareReplyReview(
        db,
        "invalid",
        options,
        key,
        "synthetic_commenter",
        fetcher,
      ),
    ).rejects.toThrow("Invalid preparation target");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await db.automationExecution.count()).toBe(0);
  });
  it("refuses changed automation before making API calls", async () => {
    const { execution, rule } = await target();
    await db.automationRule.update({
      where: { id: rule.id },
      data: { enabled: false },
    });
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      prepareReplyReview(
        db,
        execution.id,
        options,
        key,
        "synthetic_commenter",
        fetcher,
      ),
    ).rejects.toThrow("PREPARATION_RULE_DISABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses a comment which already has a queued delivery action", async () => {
    const { execution } = await target();
    await db.deliveryAction.create({
      data: { executionId: execution.id, kind: "PRIVATE_REPLY", mode: "MOCK" },
    });
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      prepareReplyReview(
        db,
        execution.id,
        options,
        key,
        "synthetic_commenter",
        fetcher,
      ),
    ).rejects.toThrow("PREPARATION_DELIVERY_EXISTS");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await db.messageAttempt.count()).toBe(0);
  });
  it("verifies the selected owned commenter rather than assuming it from a keyword", async () => {
    const { execution, event } = await target();
    await expect(
      prepareReplyReview(
        db,
        execution.id,
        options,
        key,
        "synthetic_other",
        reads(event.commentId, event.mediaId),
      ),
    ).rejects.toThrow("Test commenter identity");
    expect(await db.deliveryAction.count()).toBe(0);
  });
  it("rejects the wrong account or expired comment without any delivery mutation", async () => {
    const { execution, event } = await target();
    await expect(
      prepareReplyReview(
        db,
        execution.id,
        options,
        key,
        "synthetic_commenter",
        reads(event.commentId, event.mediaId, "wrong-account"),
      ),
    ).rejects.toThrow("Expected account");
    await expect(
      prepareReplyReview(
        db,
        execution.id,
        options,
        key,
        "synthetic_commenter",
        reads(
          event.commentId,
          event.mediaId,
          "synthetic_account",
          8 * 86400000,
        ),
      ),
    ).rejects.toThrow("not eligible");
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
  });
});
