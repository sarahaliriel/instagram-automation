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
import {
  archiveAutomationRule,
  AutomationDraftError,
  createAutomationDraft,
  readPrivateAutomationDraft,
  updateAutomationDraft,
} from "@/server/db/automation-drafts";
import {
  activateAutomationRule,
  deactivateAutomationRule,
  reviewAutomationRule,
} from "@/server/db/automation-lifecycle";
import { decryptCommentText } from "@/server/db/encryption";
import { ruleTemplateContext } from "@/server/db/automation-rules";
import { persistComments } from "@/server/db/ingest-comments";
import { processComment } from "@/server/jobs/process-comment";
import {
  requireIsolatedTestDatabaseUrl,
  resetIntegrationFixtures,
} from "./support/database";

// Prepared for the explicitly isolated rights database. Do not run this file
// without separate authorization because the integration runner clears fixtures.
const db = createDatabaseClient(
  requireIsolatedTestDatabaseUrl({ rightsTest: true }),
);
const key = "b".repeat(64);
const accountProviderId = "700000000000001";
const mediaProviderId = "800000000000001";
const ownership = { accountProviderId, mediaProviderId } as const;
const input = {
  name: "Pedido de catálogo",
  mediaProviderId,
  strategy: "WHOLE_WORD" as const,
  keyword: "FORMULÁRIO",
  privateMessageTemplate: "Mensagem privada cifrada.",
};

async function seedOwnership() {
  const account = await db.instagramAccount.create({
    data: { providerId: accountProviderId },
  });
  const media = await db.instagramMedia.create({
    data: { accountId: account.id, providerId: mediaProviderId },
  });
  return { account, media };
}

beforeAll(() => db.$connect());
beforeEach(async () => {
  await resetIntegrationFixtures(db, { includeDataRights: true });
  await seedOwnership();
});
afterAll(() => db.$disconnect());

describe("automation draft CRUD", () => {
  it("creates only an inactive draft, normalizes keywords and encrypts templates", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const rule = await createAutomationDraft(db, input, key, ownership);
    expect(rule).toMatchObject({
      enabled: false,
      archivedAt: null,
      revision: 1,
    });
    const stored = await db.automationRule.findUniqueOrThrow({
      where: { id: rule.id },
      include: { keywords: true },
    });
    expect(stored.keywords[0]?.normalizedKeyword).toBe("formulario");
    expect(stored.privateMessageTemplateCiphertext).not.toContain(
      input.privateMessageTemplate,
    );
    expect(
      decryptCommentText(
        stored.privateMessageTemplateCiphertext,
        key,
        ruleTemplateContext(rule.id, "private"),
      ),
    ).toBe(input.privateMessageTemplate);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects publications outside the authorized account", async () => {
    await expect(
      createAutomationDraft(db, input, key, {
        accountProviderId,
        mediaProviderId: "999999999999999",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_NOT_OWNED" });
  });

  it("detects concurrent edits and leaves the winner intact", async () => {
    const created = await createAutomationDraft(db, input, key, ownership);
    await updateAutomationDraft(
      db,
      created.id,
      1,
      { ...input, name: "Primeira alteração" },
      key,
      ownership,
    );
    await expect(
      updateAutomationDraft(
        db,
        created.id,
        1,
        { ...input, name: "Alteração obsoleta" },
        key,
        ownership,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await readPrivateAutomationDraft(db, created.id, key, accountProviderId),
    ).toMatchObject({ name: "Primeira alteração", revision: 2 });
  });

  it("archives logically and preserves an existing matching execution", async () => {
    const created = await createAutomationDraft(db, input, key, ownership);
    const rule = await db.automationRule.findUniqueOrThrow({
      where: { id: created.id },
      include: { keywords: true },
    });
    const account = await db.instagramAccount.findFirstOrThrow({
      where: { providerId: accountProviderId },
    });
    const media = await db.instagramMedia.findFirstOrThrow({
      where: { providerId: mediaProviderId },
    });
    const comment = await db.instagramComment.create({
      data: {
        accountId: account.id,
        mediaId: media.id,
        providerId: "900000000000001",
      },
    });
    const event = await db.webhookEvent.create({
      data: {
        accountId: account.id,
        commentId: comment.id,
        providerCommentId: comment.providerId,
        source: "MANUAL_GET",
        state: "READY_FOR_DELIVERY",
      },
    });
    const execution = await db.automationExecution.create({
      data: {
        eventId: event.id,
        accountId: account.id,
        commentId: comment.id,
        state: "READY_FOR_DELIVERY",
        reasonCode: "KEYWORD_MATCH",
        selectedRuleId: rule.id,
        matchedKeywordId: rule.keywords[0]!.id,
        selectedRuleUpdatedAt: rule.updatedAt,
        intentCiphertext: "durable-encrypted-snapshot-fixture",
      },
    });
    await expect(
      updateAutomationDraft(db, rule.id, 1, input, key, ownership),
    ).rejects.toBeInstanceOf(AutomationDraftError);
    await archiveAutomationRule(db, rule.id, 1, accountProviderId);
    expect(
      await db.automationExecution.findUnique({ where: { id: execution.id } }),
    ).not.toBeNull();
    expect(
      await db.automationRule.findUniqueOrThrow({ where: { id: rule.id } }),
    ).toMatchObject({
      enabled: false,
      archivedAt: expect.any(Date),
      revision: 2,
    });
    expect(await db.deliveryAction.count()).toBe(0);
  });

  it("activates and deactivates only the explicitly reviewed revision", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const created = await createAutomationDraft(db, input, key, ownership);
    const review = await reviewAutomationRule(
      db,
      created.id,
      key,
      accountProviderId,
    );
    await expect(
      activateAutomationRule(
        db,
        created.id,
        1,
        review.reviewDigest,
        key,
        ownership,
      ),
    ).resolves.toMatchObject({ enabled: true, revision: 2 });
    const firstActivation = await db.automationRule.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(firstActivation.activatedAt).toBeInstanceOf(Date);
    const activeReview = await reviewAutomationRule(
      db,
      created.id,
      key,
      accountProviderId,
    );
    await expect(
      deactivateAutomationRule(
        db,
        created.id,
        2,
        activeReview.reviewDigest,
        key,
        accountProviderId,
      ),
    ).resolves.toMatchObject({ enabled: false, revision: 3 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const draftReview = await reviewAutomationRule(
      db,
      created.id,
      key,
      accountProviderId,
    );
    await expect(
      activateAutomationRule(
        db,
        created.id,
        3,
        draftReview.reviewDigest,
        key,
        ownership,
      ),
    ).resolves.toMatchObject({ enabled: true, revision: 4 });
    const reactivated = await db.automationRule.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(reactivated.activatedAt!.getTime()).toBeGreaterThan(
      firstActivation.activatedAt!.getTime(),
    );
    expect(await db.automationExecution.count()).toBe(0);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
    expect(network).not.toHaveBeenCalled();
  });

  it("preserves decisions and excludes backlog from earlier activation periods", async () => {
    const created = await createAutomationDraft(db, input, key, ownership);
    const activate = async (revision: number) => {
      const review = await reviewAutomationRule(
        db,
        created.id,
        key,
        accountProviderId,
      );
      await activateAutomationRule(
        db,
        created.id,
        revision,
        review.reviewDigest,
        key,
        ownership,
      );
      return db.automationRule.findUniqueOrThrow({ where: { id: created.id } });
    };
    const receive = async (commentId: string) => {
      await persistComments(
        db,
        [
          {
            eventId: commentId,
            accountId: accountProviderId,
            mediaId: mediaProviderId,
            commentId,
            notificationTime: 1,
            text: "FORMULÁRIO",
          },
        ],
        key,
      );
      const event = await db.webhookEvent.findFirstOrThrow({
        where: { providerCommentId: commentId },
      });
      // Synthetic provider evidence, strictly before local receipt.
      const providerCreatedAt = new Date(event.createdAt.getTime() - 1);
      await db.instagramComment.update({
        where: { id: event.commentId },
        data: { providerCreatedAt },
      });
      return { ...event, providerCreatedAt };
    };
    const before = await receive("101");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const first = await activate(1);
    expect(first.revision).toBe(2);
    expect(before.providerCreatedAt.getTime()).toBeLessThan(
      first.activatedAt!.getTime(),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const eligible = await receive("102");
    const backlog = await receive("103");
    expect(eligible.providerCreatedAt.getTime()).toBeGreaterThan(
      first.activatedAt!.getTime(),
    );
    expect(
      (await processComment(db, eligible.id, key, new Date(Date.now() + 1000)))
        .state,
    ).toBe("READY_FOR_DELIVERY");
    const original = await db.automationExecution.findUniqueOrThrow({
      where: { eventId: eligible.id },
    });
    const activeReview = await reviewAutomationRule(
      db,
      created.id,
      key,
      accountProviderId,
    );
    await deactivateAutomationRule(
      db,
      created.id,
      2,
      activeReview.reviewDigest,
      key,
      accountProviderId,
    );
    expect(
      (await db.automationRule.findUniqueOrThrow({ where: { id: created.id } }))
        .revision,
    ).toBe(3);
    const duringDraft = await receive("104");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await activate(3);
    expect(second.revision).toBe(4);
    expect(second.activatedAt!.getTime()).toBeGreaterThan(
      first.activatedAt!.getTime(),
    );
    for (const event of [before, backlog, duringDraft]) {
      expect(event.providerCreatedAt.getTime()).toBeLessThan(
        second.activatedAt!.getTime(),
      );
      expect(
        (await processComment(db, event.id, key, new Date(Date.now() + 1000)))
          .state,
      ).toBe("SKIPPED");
      expect(
        await db.automationExecution.findUnique({
          where: { eventId: event.id },
        }),
      ).toBeNull();
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    const afterReactivation = await receive("105");
    expect(afterReactivation.providerCreatedAt.getTime()).toBeGreaterThan(
      second.activatedAt!.getTime(),
    );
    expect(
      (
        await processComment(
          db,
          afterReactivation.id,
          key,
          new Date(Date.now() + 1000),
        )
      ).state,
    ).toBe("READY_FOR_DELIVERY");
    expect(
      await db.automationExecution.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toEqual(original);
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
  });

  it("rejects archived, stale and unreviewed activation", async () => {
    const created = await createAutomationDraft(db, input, key, ownership);
    const review = await reviewAutomationRule(
      db,
      created.id,
      key,
      accountProviderId,
    );
    await updateAutomationDraft(
      db,
      created.id,
      1,
      { ...input, name: "Changed concurrently" },
      key,
      ownership,
    );
    await expect(
      activateAutomationRule(
        db,
        created.id,
        1,
        review.reviewDigest,
        key,
        ownership,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await archiveAutomationRule(db, created.id, 2, accountProviderId);
    const archivedReview = await reviewAutomationRule(
      db,
      created.id,
      key,
      accountProviderId,
    );
    await expect(
      activateAutomationRule(
        db,
        created.id,
        3,
        archivedReview.reviewDigest,
        key,
        ownership,
      ),
    ).rejects.toMatchObject({ code: "NOT_ACTIVATABLE" });
  });

  it("requires a fresh review when the active conflict set changes", async () => {
    const created = await createAutomationDraft(db, input, key, ownership);
    const review = await reviewAutomationRule(
      db,
      created.id,
      key,
      accountProviderId,
    );
    const competing = await createAutomationDraft(
      db,
      { ...input, name: "Competing rule" },
      key,
      ownership,
    );
    await db.automationRule.update({
      where: { id: competing.id },
      data: { enabled: true },
    });
    await expect(
      activateAutomationRule(
        db,
        created.id,
        1,
        review.reviewDigest,
        key,
        ownership,
      ),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(await db.deliveryAction.count()).toBe(0);
    expect(await db.messageAttempt.count()).toBe(0);
  });
});
