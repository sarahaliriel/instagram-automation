import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  commentFixture,
  webhookConfig,
} from "../../../tests/fixtures/instagram";
import { receiveWebhook, verifyWebhook } from "./instagram-handler";
import { verifyInstagramSignature } from "./signature";

function signedRequest(
  body: string,
  signature?: string,
  contentType = "application/json",
) {
  return new Request("https://app.example.com/api/webhooks/instagram", {
    method: "POST",
    body,
    headers: {
      "Content-Type": contentType,
      "X-Hub-Signature-256":
        signature ??
        `sha256=${createHmac("sha256", webhookConfig.appSecret).update(body).digest("hex")}`,
    },
  });
}
function verification(
  token: string | null = webhookConfig.verifyToken,
  mode = "subscribe",
  challenge: string | null = "123456789",
) {
  const url = new URL("https://app.example.com/api/webhooks/instagram");
  url.searchParams.set("hub.mode", mode);
  if (token !== null) url.searchParams.set("hub.verify_token", token);
  if (challenge !== null) url.searchParams.set("hub.challenge", challenge);
  return new Request(url);
}

describe("webhook verification", () => {
  it("returns the exact challenge as uncached plain text for a valid token", async () => {
    const response = verifyWebhook(verification(), webhookConfig);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("123456789");
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each(["invalid-token", null, ""])(
    "rejects invalid/missing verification token %s",
    (token) => {
      expect(verifyWebhook(verification(token), webhookConfig).status).toBe(
        403,
      );
    },
  );
  it("rejects unexpected mode", () =>
    expect(
      verifyWebhook(verification(undefined, "unsubscribe"), webhookConfig)
        .status,
    ).toBe(403));
  it.each([null, "", "<script>"])(
    "rejects missing or malformed challenge %s",
    (challenge) => {
      expect(
        verifyWebhook(
          verification(undefined, undefined, challenge),
          webhookConfig,
        ).status,
      ).toBe(400);
    },
  );
  it("rejects duplicate query parameters", () => {
    const url = new URL(verification().url);
    url.searchParams.append("hub.verify_token", webhookConfig.verifyToken);
    expect(verifyWebhook(new Request(url), webhookConfig).status).toBe(403);
  });
});

describe("signed notifications", () => {
  it("validates the HMAC over exact raw bytes including UTF-8", () => {
    const body = JSON.stringify(commentFixture());
    const signature = `sha256=${createHmac("sha256", webhookConfig.appSecret).update(body).digest("hex")}`;
    expect(
      verifyInstagramSignature(
        Buffer.from(body),
        signature,
        webhookConfig.appSecret,
      ),
    ).toBe(true);
    expect(
      verifyInstagramSignature(
        Buffer.from(body + " "),
        signature,
        webhookConfig.appSecret,
      ),
    ).toBe(false);
    expect(
      verifyInstagramSignature(Buffer.from(body), signature, "wrong-secret"),
    ).toBe(false);
  });
  it.each([
    "sha256=" + "0".repeat(64),
    "sha1=" + "a".repeat(40),
    "sha256=malformed",
    "",
  ])(
    "rejects invalid signature %s before JSON validation",
    async (signature) => {
      expect(
        (
          await receiveWebhook(
            signedRequest("not-json", signature),
            webhookConfig,
          )
        ).status,
      ).toBe(401);
    },
  );
  it("rejects absent signature", async () => {
    expect(
      (
        await receiveWebhook(
          new Request("https://example.com", { method: "POST", body: "{}" }),
          webhookConfig,
        )
      ).status,
    ).toBe(401);
  });
  it("rejects signed malformed JSON", async () => {
    expect(
      (await receiveWebhook(signedRequest("{broken-json"), webhookConfig))
        .status,
    ).toBe(400);
  });
  it("rejects unsupported content type after authentication", async () => {
    expect(
      (
        await receiveWebhook(
          signedRequest("{}", undefined, "text/plain"),
          webhookConfig,
        )
      ).status,
    ).toBe(415);
  });
  it("validates a comment but does not acknowledge it without durable storage", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await receiveWebhook(
      signedRequest(JSON.stringify(commentFixture())),
      webhookConfig,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "durable_ingestion_unavailable",
    });
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it("explicitly discards unsupported event types without a business action", async () => {
    const body = commentFixture();
    body.entry[0]!.changes[0]!.field = "live_comments";
    const response = await receiveWebhook(
      signedRequest(JSON.stringify(body)),
      webhookConfig,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ignored_unsupported_event",
    });
  });
  it("does not acknowledge a mixed batch containing a supported comment", async () => {
    const body = commentFixture();
    body.entry[0]!.changes.push({
      ...body.entry[0]!.changes[0]!,
      field: "unsupported",
    });
    expect(
      (await receiveWebhook(signedRequest(JSON.stringify(body)), webhookConfig))
        .status,
    ).toBe(503);
  });
  it("rejects signed missing comment fields", async () => {
    const body = JSON.stringify(commentFixture()).replace(
      '"comment_id":"200000000000001",',
      "",
    );
    expect(
      (await receiveWebhook(signedRequest(body), webhookConfig)).status,
    ).toBe(400);
  });
  it("rejects oversized chunked bodies without trusting content length", async () => {
    expect(
      (
        await receiveWebhook(
          signedRequest("x".repeat(1024 * 1024 + 1)),
          webhookConfig,
        )
      ).status,
    ).toBe(413);
  });
  it("repeated notifications never produce a successful acceptance", async () => {
    for (let index = 0; index < 2; index++) {
      expect(
        (
          await receiveWebhook(
            signedRequest(JSON.stringify(commentFixture())),
            webhookConfig,
          )
        ).status,
      ).toBe(503);
    }
  });
});

describe("durable acceptance boundary", () => {
  it("does not respond successfully before the acceptance callback resolves", async () => {
    let release!: () => void;
    const committed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const accept = vi.fn(async () => {
      await committed;
    });
    let returned = false;
    const pending = receiveWebhook(
      signedRequest(JSON.stringify(commentFixture())),
      webhookConfig,
      accept,
    ).then((response) => {
      returned = true;
      return response;
    });
    await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    expect(returned).toBe(false);
    release();
    expect((await pending).status).toBe(200);
  });
  it("does not interpret a persistence error as an invalid event or leak it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await receiveWebhook(
      signedRequest(JSON.stringify(commentFixture())),
      webhookConfig,
      async () => {
        throw new Error("private database credentials");
      },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("credentials");
    expect(JSON.stringify(log.mock.calls)).not.toContain("credentials");
  });
});
