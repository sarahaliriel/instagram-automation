import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDatabaseClient } from "@/server/db/client";
import { persistComments } from "@/server/db/ingest-comments";
import {
  createAutomationRule,
  ruleTemplateContext,
} from "@/server/db/automation-rules";
import { decryptDeliveryIntent } from "@/server/db/delivery-intent";
import { encryptCommentText } from "@/server/db/encryption";
import { processComment } from "@/server/jobs/process-comment";
import { dispatchOutbox } from "@/server/jobs/dispatch-outbox";
import { parseInstagramEvents } from "@/modules/webhooks/comment-events";
import { commentFixture, webhookConfig } from "../fixtures/instagram";
import { automationRuleFixture, RULE_IDS } from "../fixtures/automation-rules";
import type { AutomationRuleInput } from "@/modules/automations/rule-schema";
import {
  recordSyntheticCommentCreation,
  recordSyntheticRuleActivation,
} from "./support/temporal-matching-fixture";
import {
  requireIsolatedTestDatabaseUrl,
  resetIntegrationFixtures,
} from "./support/database";

const url = requireIsolatedTestDatabaseUrl();
const db = createDatabaseClient(url);
const key = "a".repeat(64);
const now = (ms = 1000) => new Date(Date.now() + ms);
async function ingest(
  text: string | null = "FORMULÁRIO",
  commentId = "200000000000001",
) {
  const batch = parseInstagramEvents(
    commentFixture(),
    webhookConfig.accountId,
    webhookConfig.appSecret,
  ).comments.map((event) => ({
    ...event,
    commentId,
    text: text === null ? undefined : text,
  }));
  await persistComments(db, batch, key);
  return db.webhookEvent.findFirstOrThrow({
    where: { providerCommentId: commentId },
  });
}
async function ingestForMatching(
  text: string | null = "FORMULÁRIO",
  commentId = "200000000000001",
) {
  const receipt = await ingest(text, commentId);
  await recordSyntheticCommentCreation(db, receipt.commentId);
  return receipt;
}
async function addRule(
  accountId: string,
  overrides: Partial<AutomationRuleInput> = {},
  id = RULE_IDS.first,
) {
  const rule = await createAutomationRule(
    db,
    automationRuleFixture(accountId, overrides),
    key,
    id,
  );
  return rule.enabled ? recordSyntheticRuleActivation(db, rule.id) : rule;
}
const execution = (eventId: string) =>
  db.automationExecution.findUniqueOrThrow({ where: { eventId } });
beforeAll(async () => {
  await db.$connect();
});
beforeEach(async () => {
  await resetIntegrationFixtures(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("persistent automation decisions", () => {
  it("never retroactively rematches a historical Phase 4 execution", async () => {
    const event = await ingest();
    const original = await db.automationExecution.create({
      data: {
        eventId: event.id,
        accountId: event.accountId,
        commentId: event.commentId,
        state: "SKIPPED",
        reasonCode: "AUTOMATION_NOT_IMPLEMENTED",
        engineVersion: "legacy-phase4",
      },
    });
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { state: "PROCESSED" },
    });
    await db.outboxMessage.update({
      where: { eventId: event.id },
      data: { state: "COMPLETED" },
    });
    await addRule(event.accountId);
    await ingest();
    expect(await processComment(db, event.id, key, now())).toEqual({
      state: "PROCESSED",
    });
    expect(await execution(event.id)).toEqual(original);
  });
  it("uses canonical UUID casing for encrypted rule templates", async () => {
    const event = await ingestForMatching();
    const id = "ABCDEF00-0000-4000-8000-000000000001";
    const rule = await addRule(event.accountId, {}, id);
    expect(rule.id).toBe(id.toLowerCase());
    expect(await processComment(db, event.id, key, now())).toEqual({
      state: "READY_FOR_DELIVERY",
    });
  });
  it("rejects an execution labelled ready without a complete intent", async () => {
    const event = await ingest();
    await expect(
      db.automationExecution.create({
        data: {
          eventId: event.id,
          accountId: event.accountId,
          commentId: event.commentId,
          state: "READY_FOR_DELIVERY",
          reasonCode: "KEYWORD_MATCH",
        },
      }),
    ).rejects.toThrow();
    expect(await db.automationExecution.count()).toBe(0);
  });

  it("creates one encrypted delivery intent and never invokes external HTTP", async () => {
    const event = await ingestForMatching();
    const rule = await addRule(event.accountId);
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("External HTTP is forbidden");
    });
    expect(await processComment(db, event.id, key, now())).toEqual({
      state: "READY_FOR_DELIVERY",
    });
    expect(network).not.toHaveBeenCalled();
    const decision = await execution(event.id);
    expect(decision).toMatchObject({
      state: "READY_FOR_DELIVERY",
      selectedRuleId: rule.id,
      engineVersion: "matching-v1",
      reasonCode: "KEYWORD_MATCH",
    });
    const intent = decryptDeliveryIntent(
      decision.id,
      decision.intentCiphertext!,
      key,
    );
    expect(intent).toMatchObject({
      ruleId: rule.id,
      normalizedKeyword: "formulario",
      privateMessage: "Synthetic private reply for isolated tests.",
      publicFallbackMessage: null,
    });
    expect(JSON.stringify(rule)).not.toContain(
      "Synthetic private reply for isolated tests.",
    );
    expect(JSON.stringify(decision)).not.toContain(
      "Synthetic private reply for isolated tests.",
    );
    expect(
      (await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .state,
    ).toBe("READY_FOR_DELIVERY");
    expect(
      (
        await db.outboxMessage.findUniqueOrThrow({
          where: { eventId: event.id },
        })
      ).state,
    ).toBe("COMPLETED");
    expect(() =>
      decryptDeliveryIntent(RULE_IDS.third, decision.intentCiphertext!, key),
    ).toThrow();
  });
  it.each([
    [null, "COMMENT_WITHOUT_TEXT"],
    [" \n\t ", "EMPTY_COMMENT"],
    ["other", "NO_MATCHING_RULE"],
  ] as const)(
    "skips %s with a precise reason and no intent",
    async (text, reason) => {
      const event = await ingestForMatching(text);
      await addRule(event.accountId);
      expect(await processComment(db, event.id, key, now())).toEqual({
        state: "SKIPPED",
      });
      expect(await execution(event.id)).toMatchObject({
        state: "SKIPPED",
        reasonCode: reason,
        selectedRuleId: null,
        matchedKeywordId: null,
        intentCiphertext: null,
      });
    },
  );
  it("selects media-specific rules before higher global priorities and snapshots fallback only as configuration", async () => {
    const event = await ingestForMatching();
    const comment = await db.instagramComment.findUniqueOrThrow({
      where: { id: event.commentId },
    });
    await addRule(event.accountId, { priority: 1000 });
    const specific = await addRule(
      event.accountId,
      {
        scope: "MEDIA",
        mediaId: comment.mediaId,
        priority: -1000,
        publicFallbackTemplate: "Synthetic fallback instructions.",
      },
      RULE_IDS.second,
    );
    await processComment(db, event.id, key, now());
    const decision = await execution(event.id);
    expect(decision.selectedRuleId).toBe(specific.id);
    expect(
      decryptDeliveryIntent(decision.id, decision.intentCiphertext!, key)
        .publicFallbackMessage,
    ).toBe("Synthetic fallback instructions.");
    expect(await db.automationExecution.count()).toBe(1);
  });
  it("uses the highest priority, then the lowest UUID for ambiguous global matches", async () => {
    const event = await ingestForMatching();
    await addRule(event.accountId, { priority: 8 }, RULE_IDS.second);
    await addRule(event.accountId, { priority: 7 }, RULE_IDS.third);
    await addRule(event.accountId, { priority: 8 }, RULE_IDS.first);
    await processComment(db, event.id, key, now());
    expect((await execution(event.id)).selectedRuleId).toBe(RULE_IDS.first);
  });
  it("excludes disabled rules, other accounts and other media", async () => {
    const event = await ingest();
    const otherAccount = await db.instagramAccount.create({
      data: { providerId: "900000000000001" },
    });
    const otherMedia = await db.instagramMedia.create({
      data: { accountId: event.accountId, providerId: "900000000000002" },
    });
    await addRule(event.accountId, { enabled: false });
    await addRule(otherAccount.id, {}, RULE_IDS.second);
    await addRule(
      event.accountId,
      { scope: "MEDIA", mediaId: otherMedia.id },
      RULE_IDS.third,
    );
    await processComment(db, event.id, key, now());
    expect((await execution(event.id)).reasonCode).toBe("NO_MATCHING_RULE");
  });
  it("matches multiple keywords and whole-word text through the real worker", async () => {
    const event = await ingestForMatching("Preciso de INFO, por favor.");
    await addRule(event.accountId, {
      strategy: "WHOLE_WORD",
      keywords: ["formulário", "INFO"],
    });
    await processComment(db, event.id, key, now());
    const decision = await execution(event.id);
    expect(
      decryptDeliveryIntent(decision.id, decision.intentCiphertext!, key)
        .normalizedKeyword,
    ).toBe("info");
  });
  it("preserves one decision across repeated webhooks, HMAC rotation and concurrent workers", async () => {
    const event = await ingestForMatching();
    await addRule(event.accountId);
    await Promise.all(
      Array.from({ length: 8 }, () => processComment(db, event.id, key, now())),
    );
    const first = await execution(event.id);
    const batch = parseInstagramEvents(
      commentFixture(),
      webhookConfig.accountId,
      "rotated-test-secret",
    ).comments;
    await Promise.all([
      persistComments(db, batch, key),
      persistComments(db, batch, key),
    ]);
    expect(await processComment(db, event.id, key, now(5000))).toEqual({
      state: "READY_FOR_DELIVERY",
    });
    expect(await db.automationExecution.count()).toBe(1);
    expect((await execution(event.id)).intentCiphertext).toBe(
      first.intentCiphertext,
    );
    const send = vi.fn(async () => {});
    await dispatchOutbox(db, send, 1, now(1000000));
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps the intent immutable after configuration edits and an explicit receipt requeue", async () => {
    const event = await ingestForMatching();
    const rule = await addRule(event.accountId);
    await processComment(db, event.id, key, now());
    const first = await execution(event.id);
    await db.automationRule.update({
      where: { id: rule.id },
      data: {
        enabled: false,
        privateMessageTemplateCiphertext: encryptCommentText(
          "Changed synthetic reply",
          key,
          ruleTemplateContext(rule.id, "private"),
        ),
      },
    });
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { state: "RECEIVED" },
    });
    expect(await processComment(db, event.id, key, now(10000))).toEqual({
      state: "READY_FOR_DELIVERY",
    });
    expect(await execution(event.id)).toEqual(first);
    expect(
      decryptDeliveryIntent(first.id, first.intentCiphertext!, key)
        .privateMessage,
    ).toBe("Synthetic private reply for isolated tests.");
  });
  it("rejects invalid templates before creating any rule", async () => {
    const event = await ingest();
    await expect(
      addRule(event.accountId, { privateMessageTemplate: "{{username}}" }),
    ).rejects.toThrow("Invalid automation rule configuration");
    await expect(
      addRule(event.accountId, { publicFallbackTemplate: " " }),
    ).rejects.toThrow();
    expect(await db.automationRule.count()).toBe(0);
  });
  it("revalidates the winning template and never prepares an invalid delivery intent", async () => {
    const event = await ingestForMatching();
    const rule = await addRule(event.accountId);
    await db.automationRule.update({
      where: { id: rule.id },
      data: {
        privateMessageTemplateCiphertext: encryptCommentText(
          "{{username}}",
          key,
          ruleTemplateContext(rule.id, "private"),
        ),
      },
    });
    expect(await processComment(db, event.id, key, now())).toEqual({
      state: "FAILED_PERMANENT",
    });
    expect(await db.automationExecution.count()).toBe(0);
  });
  it("fails closed on inconsistent normalized keywords", async () => {
    const event = await ingestForMatching();
    const rule = await addRule(event.accountId);
    await db.automationKeyword.update({
      where: { id: rule.keywords[0]!.id },
      data: { normalizedKeyword: "inconsistent" },
    });
    expect(await processComment(db, event.id, key, now())).toEqual({
      state: "FAILED_PERMANENT",
    });
    expect(await db.automationExecution.count()).toBe(0);
  });
  it("rolls back failed intent persistence and safely retries a real serialization failure", async () => {
    const event = await ingestForMatching();
    await addRule(event.accountId);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION phase5a_fail_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic serialization failure' USING ERRCODE = '40001'; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER phase5a_fail_intent BEFORE INSERT ON "ProcessingExecution" FOR EACH ROW EXECUTE FUNCTION phase5a_fail_intent()`,
    );
    try {
      await expect(processComment(db, event.id, key, now())).rejects.toThrow(
        "temporarily unavailable",
      );
      expect(await db.automationExecution.count()).toBe(0);
      expect(
        (await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } }))
          .state,
      ).toBe("FAILED_RETRYABLE");
      expect(
        (
          await db.outboxMessage.findUniqueOrThrow({
            where: { eventId: event.id },
          })
        ).state,
      ).not.toBe("COMPLETED");
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER phase5a_fail_intent ON "ProcessingExecution"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION phase5a_fail_intent()`);
    }
    expect(await processComment(db, event.id, key, now(10000))).toEqual({
      state: "READY_FOR_DELIVERY",
    });
    expect(await db.automationExecution.count()).toBe(1);
  });
  it("recovers processing after a restart and an expired lease", async () => {
    const event = await ingestForMatching();
    await addRule(event.accountId);
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        state: "PROCESSING",
        leaseToken: RULE_IDS.third,
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const restarted = createDatabaseClient(url!);
    try {
      expect(await processComment(restarted, event.id, key, now())).toEqual({
        state: "READY_FOR_DELIVERY",
      });
      expect(
        await processComment(restarted, event.id, key, now(10000)),
      ).toEqual({ state: "READY_FOR_DELIVERY" });
    } finally {
      await restarted.$disconnect();
    }
    expect(await db.automationExecution.count()).toBe(1);
  });
  it("enforces canonical comment uniqueness even if a different event UUID is supplied", async () => {
    const event = await ingestForMatching();
    await addRule(event.accountId);
    await processComment(db, event.id, key, now());
    const existing = await execution(event.id);
    const another = await ingest("other", "200000000000002");
    const { id: _id, ...data } = existing;
    void _id;
    await expect(
      db.automationExecution.create({ data: { ...data, eventId: another.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await db.automationExecution.count()).toBe(1);
  });
  it("enforces same-account media scope and normalized keyword uniqueness in PostgreSQL", async () => {
    const event = await ingest();
    const otherAccount = await db.instagramAccount.create({
      data: { providerId: "900000000000001" },
    });
    const otherMedia = await db.instagramMedia.create({
      data: { accountId: otherAccount.id, providerId: "900000000000002" },
    });
    await expect(
      addRule(event.accountId, { scope: "MEDIA", mediaId: otherMedia.id }),
    ).rejects.toMatchObject({ code: "P2003" });
    const rule = await addRule(event.accountId);
    await expect(
      db.automationKeyword.create({
        data: {
          ruleId: rule.id,
          originalKeyword: "formulario",
          normalizedKeyword: "formulario",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      db.automationRule.update({
        where: { id: rule.id },
        data: { scope: "MEDIA", mediaId: null },
      }),
    ).rejects.toThrow();
  });
});
