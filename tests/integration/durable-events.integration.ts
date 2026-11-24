import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { createDatabaseClient } from "@/server/db/client";
import { persistComments } from "@/server/db/ingest-comments";
import {
  commentEncryptionContext,
  decryptCommentText,
} from "@/server/db/encryption";
import { parseInstagramEvents } from "@/modules/webhooks/comment-events";
import { receiveWebhook } from "@/modules/webhooks/instagram-handler";
import {
  dispatchOutbox,
  type DispatchPayload,
} from "@/server/jobs/dispatch-outbox";
import { processComment } from "@/server/jobs/process-comment";
import { commentFixture, webhookConfig } from "../fixtures/instagram";
import {
  requireIsolatedTestDatabaseUrl,
  resetIntegrationFixtures,
} from "./support/database";

const url = requireIsolatedTestDatabaseUrl();
const db = createDatabaseClient(url);
const key = "a".repeat(64);
const events = () =>
  parseInstagramEvents(
    commentFixture(),
    webhookConfig.accountId,
    webhookConfig.appSecret,
  ).comments;
const persist = (batch = events()) => persistComments(db, batch, key);
const future = (ms = 1000) => new Date(Date.now() + ms);
const receipt = () => db.webhookEvent.findFirstOrThrow();
function request(payload: unknown, signature?: string) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Request("https://example.com/api/webhooks/instagram", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256":
        signature ??
        `sha256=${createHmac("sha256", webhookConfig.appSecret).update(body).digest("hex")}`,
    },
  });
}
const accept = (batch: ReturnType<typeof events>) =>
  persistComments(db, batch, key);
beforeAll(async () => {
  await db.$connect();
});
beforeEach(async () => {
  await resetIntegrationFixtures(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("PostgreSQL durable ingestion", () => {
  it("acknowledges only after entities, encrypted text and outbox commit", async () => {
    const response = await receiveWebhook(
      request(commentFixture()),
      webhookConfig,
      accept,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(await db.instagramAccount.count()).toBe(1);
    expect(await db.instagramMedia.count()).toBe(1);
    const comment = await db.instagramComment.findFirstOrThrow();
    expect(JSON.stringify(comment)).not.toContain("synthetic fixture");
    expect(JSON.stringify(comment)).not.toContain("synthetic_test_user");
    expect(
      decryptCommentText(
        comment.textCiphertext!,
        key,
        commentEncryptionContext(
          webhookConfig.accountId,
          events()[0]!.commentId,
        ),
      ),
    ).toBe(events()[0]!.text);
    expect((await receipt()).state).toBe("RECEIVED");
    expect((await db.outboxMessage.findFirstOrThrow()).state).toBe("PENDING");
  });
  it("deduplicates canonical identifiers despite rotated HMACs and changed timestamps/text", async () => {
    await persist();
    await persist(
      events().map((event) => ({
        ...event,
        eventId: "rotated-hmac",
        notificationTime: event.notificationTime + 2,
        text: "changed duplicate",
      })),
    );
    expect(await db.webhookEvent.count()).toBe(1);
    expect(await db.outboxMessage.count()).toBe(1);
    expect(await db.instagramComment.count()).toBe(1);
    expect(await db.eventTransition.count()).toBe(1);
  });
  it("preserves a pre-migration canonical receipt when Unified Login delivers the same comment", async () => {
    // The stored domain identity is independent of the original provider JSON field name.
    const historical = events()[0]!;
    await persist([
      { ...historical, eventId: "historical-instagram-login-hmac" },
    ]);
    const original = await receipt();
    await processComment(db, original.id, key, future());
    const decision = await db.automationExecution.findFirstOrThrow();
    const response = await receiveWebhook(
      request(commentFixture()),
      webhookConfig,
      accept,
    );
    expect(response.status).toBe(200);
    expect(await db.webhookEvent.count()).toBe(1);
    expect(await db.instagramAccount.count()).toBe(1);
    expect(await db.instagramComment.count()).toBe(1);
    expect(await db.automationExecution.findFirstOrThrow()).toEqual(decision);
    expect((await receipt()).id).toBe(original.id);
    expect((await db.outboxMessage.findFirstOrThrow()).state).toBe("COMPLETED");
  });
  it("rejects signed old-model and ambiguous payloads before durable acceptance", async () => {
    const acceptance = vi.fn(accept);
    for (const mixed of [false, true]) {
      const fixture = commentFixture();
      const value = fixture.entry[0]!.changes[0]!.value;
      const legacy = { ...value, id: value.comment_id };
      if (!mixed) Reflect.deleteProperty(legacy, "comment_id");
      Object.assign(fixture.entry[0]!.changes[0]!, { value: legacy });
      expect(
        (await receiveWebhook(request(fixture), webhookConfig, acceptance))
          .status,
      ).toBe(400);
    }
    expect(acceptance).not.toHaveBeenCalled();
    expect(await db.webhookEvent.count()).toBe(0);
  });
  it("accepts concurrent duplicate webhooks with one durable receipt", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        receiveWebhook(request(commentFixture()), webhookConfig, accept),
      ),
    );
    expect(results.map((response) => response.status)).toEqual(
      Array(8).fill(200),
    );
    expect(await db.webhookEvent.count()).toBe(1);
    expect(await db.outboxMessage.count()).toBe(1);
    expect(await db.eventTransition.count()).toBe(1);
  });
  it("rolls back the entire batch on persistence failure", async () => {
    await expect(
      persist([
        events()[0]!,
        { ...events()[0]!, commentId: "2", notificationTime: NaN },
      ]),
    ).rejects.toThrow();
    expect(await db.webhookEvent.count()).toBe(0);
    expect(await db.instagramComment.count()).toBe(0);
    expect(await db.outboxMessage.count()).toBe(0);
  });
  it("returns 503 on a real database connection failure without leaking input", async () => {
    const unavailable = createDatabaseClient(
      "postgresql://unused@127.0.0.1:1/unavailable_test",
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        (
          await receiveWebhook(
            request(commentFixture()),
            webhookConfig,
            (batch) => persistComments(unavailable, batch, key),
          )
        ).status,
      ).toBe(503);
      expect(await db.webhookEvent.count()).toBe(0);
      expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic fixture");
      expect(JSON.stringify(log.mock.calls)).not.toContain("postgresql:");
    } finally {
      await unavailable.$disconnect();
    }
  });
  it("rejects signatures, malformed payloads and unauthorized accounts before persistence", async () => {
    const acceptance = vi.fn(accept);
    expect(
      (
        await receiveWebhook(
          request(commentFixture(), "sha256=" + "0".repeat(64)),
          webhookConfig,
          acceptance,
        )
      ).status,
    ).toBe(401);
    expect(
      (await receiveWebhook(request("{broken"), webhookConfig, acceptance))
        .status,
    ).toBe(400);
    expect(
      (
        await receiveWebhook(
          request({ object: "instagram", entry: [{}] }),
          webhookConfig,
          acceptance,
        )
      ).status,
    ).toBe(400);
    const unauthorized = commentFixture();
    unauthorized.entry[0]!.id = "999";
    expect(
      (await receiveWebhook(request(unauthorized), webhookConfig, acceptance))
        .status,
    ).toBe(400);
    expect(acceptance).not.toHaveBeenCalled();
  });
  it("preserves explicit unsupported handling without inventing durable acceptance", async () => {
    const fixture = commentFixture();
    fixture.entry[0]!.changes[0]!.field = "unsupported";
    const acceptance = vi.fn(accept);
    const response = await receiveWebhook(
      request(fixture),
      webhookConfig,
      acceptance,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ignored_unsupported_event",
    });
    expect(acceptance).not.toHaveBeenCalled();
    expect(await db.webhookEvent.count()).toBe(0);
  });
  it("enforces canonical uniqueness independently of ingestion code", async () => {
    await persist();
    const original = await receipt();
    await expect(
      db.webhookEvent.create({
        data: {
          provider: original.provider,
          accountId: original.accountId,
          providerCommentId: original.providerCommentId,
          commentId: original.commentId,
          notificationTime: original.notificationTime,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("canonical relational identity", () => {
  it("rejects a receipt whose provider comment ID does not match its comment FK", async () => {
    await persist();
    const original = await receipt();
    await expect(
      db.webhookEvent.create({
        data: {
          provider: original.provider,
          accountId: original.accountId,
          providerCommentId: "999999",
          commentId: original.commentId,
          notificationTime: original.notificationTime,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("durable dispatch and processing", () => {
  it("survives commit-before-dispatch and records one explicit skipped action", async () => {
    await persist();
    const restarted = createDatabaseClient(url!);
    const jobs: DispatchPayload[] = [];
    try {
      expect(
        await dispatchOutbox(
          restarted,
          async (job) => {
            jobs.push(job);
          },
          1,
          future(),
        ),
      ).toEqual({ dispatched: 1, failed: 0 });
      expect(Object.keys(jobs[0]!.data)).toEqual(["eventId"]);
      expect(JSON.stringify(jobs)).not.toContain("FORMULÁRIO");
      expect((await receipt()).state).toBe("PENDING");
      expect(
        await processComment(
          restarted,
          jobs[0]!.data.eventId,
          key,
          future(2000),
        ),
      ).toEqual({ state: "SKIPPED" });
      expect((await db.outboxMessage.findFirstOrThrow()).state).toBe(
        "COMPLETED",
      );
      expect(await db.automationExecution.findFirstOrThrow()).toMatchObject({
        state: "SKIPPED",
        reasonCode: "NO_MATCHING_RULE",
      });
      expect(
        (
          await db.eventTransition.findMany({ orderBy: { createdAt: "asc" } })
        ).map((item) => item.state),
      ).toEqual(["RECEIVED", "PENDING", "PROCESSING", "SKIPPED"]);
    } finally {
      await restarted.$disconnect();
    }
  });
  it("retains dispatch failures and safely retries later", async () => {
    await persist();
    expect(
      await dispatchOutbox(
        db,
        async () => {
          throw new Error("private failure");
        },
        1,
        future(),
      ),
    ).toEqual({ dispatched: 0, failed: 1 });
    expect(await db.outboxMessage.findFirstOrThrow()).toMatchObject({
      state: "PENDING",
      attempts: 1,
      lastErrorCode: "DISPATCH_UNAVAILABLE",
    });
    expect(
      (await dispatchOutbox(db, async () => {}, 1, future(10000))).dispatched,
    ).toBe(1);
  });
  it("allows only one concurrent dispatcher to claim an outbox row", async () => {
    await persist();
    const send = vi.fn(async () => {});
    await Promise.all(
      Array.from({ length: 5 }, () => dispatchOutbox(db, send, 1, future())),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("creates one execution across concurrent duplicate jobs and later webhooks", async () => {
    await persist();
    const event = await receipt();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        processComment(db, event.id, key, future()),
      ),
    );
    expect(await db.automationExecution.count()).toBe(1);
    await persist();
    expect(await db.automationExecution.count()).toBe(1);
    expect((await receipt()).state).toBe("SKIPPED");
  });
  it("recovers expired dispatch and worker leases without another webhook", async () => {
    await persist();
    const event = await receipt();
    const expired = new Date(Date.now() - 1000);
    await db.outboxMessage.update({
      where: { eventId: event.id },
      data: {
        state: "LEASED",
        leaseToken: randomUUID(),
        leaseExpiresAt: expired,
        nextAttemptAt: expired,
      },
    });
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        state: "PROCESSING",
        leaseToken: randomUUID(),
        leaseExpiresAt: expired,
      },
    });
    expect(
      (await dispatchOutbox(db, async () => {}, 1, future())).dispatched,
    ).toBe(1);
    expect(await processComment(db, event.id, key, future(2000))).toEqual({
      state: "SKIPPED",
    });
  });
  it("redispatches accepted-but-unprocessed jobs beyond the watchdog interval", async () => {
    await persist();
    const jobs: DispatchPayload[] = [];
    const send = async (job: DispatchPayload) => {
      jobs.push(job);
    };
    await dispatchOutbox(db, send, 1, future());
    await dispatchOutbox(db, send, 1, future(200000));
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.id).not.toBe(jobs[1]!.id);
    for (const job of jobs)
      await processComment(db, job.data.eventId, key, future(201000));
    expect(await db.automationExecution.count()).toBe(1);
  });
  it("records a known transient database failure and safely retries", async () => {
    await persist();
    const event = await receipt();
    const lookup = vi
      .spyOn(db.webhookEvent, "findUnique")
      .mockRejectedValueOnce(
        Object.assign(new Error("private transient error"), { code: "P1001" }),
      );
    await expect(processComment(db, event.id, key, future())).rejects.toThrow(
      "temporarily unavailable",
    );
    lookup.mockRestore();
    expect(await receipt()).toMatchObject({
      state: "FAILED_RETRYABLE",
      lastErrorCode: "DATABASE_TEMPORARY",
    });
    expect(await processComment(db, event.id, key, future(10000))).toEqual({
      state: "SKIPPED",
    });
    expect(await db.automationExecution.count()).toBe(1);
  });
  it("retains corrupted stored events as permanent failures", async () => {
    await persist();
    const event = await receipt();
    await db.instagramComment.update({
      where: { id: event.commentId },
      data: { textCiphertext: "corrupt" },
    });
    expect(await processComment(db, event.id, key, future())).toEqual({
      state: "FAILED_PERMANENT",
    });
    expect((await receipt()).lastErrorCode).toBe("INVALID_STORED_EVENT");
    expect(await db.automationExecution.count()).toBe(0);
  });
  it("routes unclassified errors to UNKNOWN and stops automatic dispatch", async () => {
    await persist();
    const event = await receipt();
    const lookup = vi
      .spyOn(db.webhookEvent, "findUnique")
      .mockRejectedValueOnce(new Error("private unknown bug"));
    expect(await processComment(db, event.id, key, future())).toEqual({
      state: "UNKNOWN",
    });
    lookup.mockRestore();
    expect((await receipt()).lastErrorCode).toBe("PROCESSING_REQUIRES_REVIEW");
    const send = vi.fn(async () => {});
    await dispatchOutbox(db, send, 1, future(1000000));
    expect(send).not.toHaveBeenCalled();
  });
  it("stops automatic processing at the retry budget", async () => {
    await persist();
    const event = await receipt();
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { attempts: 4 },
    });
    const lookup = vi
      .spyOn(db.webhookEvent, "findUnique")
      .mockRejectedValueOnce(
        Object.assign(new Error("private"), { code: "P1001" }),
      );
    expect(await processComment(db, event.id, key, future())).toEqual({
      state: "FAILED_PERMANENT",
    });
    lookup.mockRestore();
    expect((await receipt()).lastErrorCode).toBe("RETRIES_EXHAUSTED");
  });
  it("respects an active worker lease", async () => {
    await persist();
    const event = await receipt();
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        state: "PROCESSING",
        leaseToken: randomUUID(),
        leaseExpiresAt: future(100000),
      },
    });
    expect(await processComment(db, event.id, key, future())).toEqual({
      state: "DEFERRED",
    });
    expect(await db.automationExecution.count()).toBe(0);
  });
});
