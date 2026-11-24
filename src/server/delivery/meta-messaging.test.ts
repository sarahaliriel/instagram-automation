import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMetaMessagingAdapter,
  classifyMessagingRejection,
} from "./meta-messaging";
const executionId = "10000000-0000-4000-8000-000000000001";
const approvalId = "10000000-0000-4000-8000-000000000002";
const input = {
  accountId: "10001",
  commentId: "10002",
  message: "Synthetic private response",
  idempotencyKey: "10000000-0000-4000-8000-000000000003",
};
const options = {
  apiVersion: "v27.0" as const,
  executionId,
  approvalId,
  credential: {
    kind: "business_integration_system_user" as const,
    accessToken: "synthetic-access-token",
    configId: "5",
    clientBusinessId: "6",
  },
};
function enable() {
  for (const [key, value] of Object.entries({
    NODE_ENV: "test",
    INSTAGRAM_DELIVERY_MODE: "controlled_test",
    INSTAGRAM_DELIVERY_EXECUTION_ID: executionId,
    INSTAGRAM_DELIVERY_APPROVAL_ID: approvalId,
    INSTAGRAM_DELIVERY_PREPARATION_SHA256: "a".repeat(64),
    INSTAGRAM_DELIVERY_ACCOUNT_ID: input.accountId,
    INSTAGRAM_DELIVERY_COMMENT_ID: input.commentId,
    INSTAGRAM_DELIVERY_MEDIA_ID: "10003",
    INSTAGRAM_DELIVERY_APPROVED_UNTIL: new Date(
      Date.now() + 300000,
    ).toISOString(),
    INSTAGRAM_DELIVERY_CREDENTIALS_VERIFIED: "1",
    INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED: "1",
  }))
    vi.stubEnv(key, value);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("Unified private/public messaging adapter", () => {
  it("does not send while disabled, even with a credential", async () => {
    vi.stubEnv("INSTAGRAM_DELIVERY_MODE", "disabled");
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await createMetaMessagingAdapter(
        options,
        fetcher,
      ).sendAuthorizedPrivateReply(input),
    ).toMatchObject({ kind: "API_REJECTED", reason: "AUTHORIZATION" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("posts the official comment recipient shape with redacted headers/typed acceptance", async () => {
    enable();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        message_id: "synthetic-message-id",
        recipient_id: "999",
        ignored: input.message,
      }),
    );
    const adapter = createMetaMessagingAdapter(options, fetcher);
    expect(await adapter.sendAuthorizedPrivateReply(input)).toEqual({
      kind: "API_ACCEPTED",
      operationId: "synthetic-message-id",
      delivery: "UNCONFIRMED",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v27.0/10001/messages");
    expect(String(url)).not.toContain(options.credential.accessToken);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer synthetic-access-token" },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { comment_id: input.commentId },
      message: { text: input.message },
    });
    expect(String(init?.body)).not.toContain(input.idempotencyKey);
    expect(JSON.stringify(adapter)).not.toContain(
      options.credential.accessToken,
    );
  });
  it.each([
    { ...input, accountId: "../messages" },
    { ...input, message: "" },
    { ...input, message: "{placeholder}" },
    { ...input, commentId: 12 },
    { ...input, extra: "unsupported" },
  ])("validates inputs before any request", async (invalid) => {
    enable();
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await createMetaMessagingAdapter(
        options,
        fetcher,
      ).sendAuthorizedPrivateReply(invalid as typeof input),
    ).toMatchObject({ kind: "API_REJECTED", reason: "INVALID_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [400, 190, "AUTHENTICATION"],
    [403, 10, "AUTHORIZATION"],
    [400, 100, "INVALID_INPUT"],
    [400, 368, "POLICY"],
    [429, 4, "RATE_LIMIT"],
    [400, 80002, "RATE_LIMIT"],
    [400, 551, "OTHER"],
  ])(
    "classifies definitive HTTP %i code %i without authorizing fallback",
    async (status, code, reason) => {
      enable();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code,
              message: options.credential.accessToken,
              error_user_msg: input.message,
            },
          },
          { status: status as number, headers: { "Retry-After": "120" } },
        ),
      );
      const result = await createMetaMessagingAdapter(
        options,
        fetcher,
      ).sendAuthorizedPrivateReply(input);
      expect(result).toMatchObject({
        kind: "API_REJECTED",
        reason,
        safeToRetry: reason === "RATE_LIMIT",
      });
      expect(JSON.stringify(result)).not.toContain(input.message);
      expect(JSON.stringify(result)).not.toContain(
        options.credential.accessToken,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([500, 502, 503])(
    "treats server HTTP %i failures as unknown writes",
    async (status) => {
      enable();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: { code: 2 } }, { status }));
      expect(
        await createMetaMessagingAdapter(
          options,
          fetcher,
        ).sendAuthorizedPrivateReply(input),
      ).toMatchObject({ kind: "UNKNOWN" });
    },
  );
  it.each([
    "not-json",
    JSON.stringify({ success: true }),
    JSON.stringify({ error: { message: "missing-code" } }),
    "x".repeat(1024 * 1024 + 1),
  ])("treats malformed/truncated acceptance as unknown", async (body) => {
    enable();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    expect(
      await createMetaMessagingAdapter(
        options,
        fetcher,
      ).sendAuthorizedPrivateReply(input),
    ).toMatchObject({ kind: "UNKNOWN" });
  });
  it("does not blindly retry a network timeout or leak transport exceptions", async () => {
    enable();
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new Error(input.message)),
            ),
          ),
      );
    const pending = createMetaMessagingAdapter(
      { ...options, timeoutMs: 10 },
      fetcher,
    ).sendAuthorizedPrivateReply(input);
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toEqual({
      kind: "UNKNOWN",
      requiresManualReview: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("respects an HTTP-date Retry-After without shortening it", async () => {
    enable();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: 4 } },
        {
          status: 429,
          headers: {
            "Retry-After": new Date(Date.now() + 180000).toUTCString(),
          },
        },
      ),
    );
    const result = await createMetaMessagingAdapter(
      options,
      fetcher,
    ).sendAuthorizedPrivateReply(input);
    expect(result.kind).toBe("API_REJECTED");
    if (result.kind === "API_REJECTED")
      expect(result.retryAfterMs).toBeGreaterThan(170000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires the exact approved comment and stops when approval expires", async () => {
    enable();
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createMetaMessagingAdapter(options, fetcher);
    expect(
      await adapter.sendAuthorizedPrivateReply({ ...input, commentId: "999" }),
    ).toMatchObject({ reason: "AUTHORIZATION" });
    vi.stubEnv(
      "INSTAGRAM_DELIVERY_APPROVED_UNTIL",
      new Date(Date.now() - 1000).toISOString(),
    );
    expect(await adapter.sendAuthorizedPrivateReply(input)).toMatchObject({
      reason: "AUTHORIZATION",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps public replies closed without a documented eligible rejection", async () => {
    enable();
    vi.stubEnv("INSTAGRAM_PUBLIC_FALLBACK_ENABLED", "1");
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await createMetaMessagingAdapter(
        options,
        fetcher,
      ).sendAuthorizedPublicReply({
        ...input,
        authorization: {
          kind: "CONFIRMED_ELIGIBLE_PRIVATE_REPLY_REJECTION",
          evidenceId: approvalId,
        },
      }),
    ).toMatchObject({ reason: "AUTHORIZATION" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not promote transient errors into definitive rejection", () => {
    expect(classifyMessagingRejection(400, 2)).toMatchObject({
      kind: "UNKNOWN",
    });
    expect(classifyMessagingRejection(400, 100, undefined, true)).toMatchObject(
      { kind: "UNKNOWN" },
    );
  });
});
