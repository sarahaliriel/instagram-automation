import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDeliverySettings } from "./settings-schema";
import { verifyControlledTarget } from "./preflight";
import { runControlledDeliveryTest } from "./controlled-test";
import type { PrismaClient } from "@/generated/prisma/client";
const flags = () =>
  parseDeliverySettings({
    INSTAGRAM_DELIVERY_MODE: "controlled_test",
    INSTAGRAM_DELIVERY_EXECUTION_ID: "10000000-0000-4000-8000-000000000001",
    INSTAGRAM_DELIVERY_APPROVAL_ID: "10000000-0000-4000-8000-000000000002",
    INSTAGRAM_DELIVERY_PREPARATION_SHA256: "a".repeat(64),
    INSTAGRAM_DELIVERY_ACCOUNT_ID: "1",
    INSTAGRAM_DELIVERY_COMMENT_ID: "2",
    INSTAGRAM_DELIVERY_MEDIA_ID: "3",
    INSTAGRAM_DELIVERY_APPROVED_UNTIL: new Date(
      Date.now() + 300000,
    ).toISOString(),
    INSTAGRAM_DELIVERY_CREDENTIALS_VERIFIED: "1",
    INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED: "1",
  });
function configuration() {
  for (const [key, value] of Object.entries({
    INSTAGRAM_ACCOUNT_ID: "1",
    META_SYSTEM_USER_ACCESS_TOKEN: "synthetic-preflight-token",
    META_LOGIN_CONFIG_ID: "5",
    META_CLIENT_BUSINESS_ID: "6",
    INSTAGRAM_INTEGRATION_MODE: "disabled",
  }))
    vi.stubEnv(key, value);
}
function fetcher(
  product = "FEED",
  timestamp = new Date(Date.now() - 1000).toISOString(),
  username = "synthetic_account",
  commenter = "synthetic_commenter",
) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ client_business_id: "6" }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: "1", username }] }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: "3" }] }))
    .mockResolvedValueOnce(
      Response.json({
        id: "2",
        timestamp,
        media: { id: "3", media_product_type: product },
        from: { username: commenter },
      }),
    );
}
afterEach(() => vi.unstubAllEnvs());
describe("controlled target preflight", () => {
  it("verifies portfolio, allowlisted account, owned media and actual creation time through GETs", async () => {
    configuration();
    const read = fetcher();
    expect((await verifyControlledTarget(flags(), read)).product).toBe("FEED");
    expect(read).toHaveBeenCalledTimes(4);
    for (const [url, init] of read.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(String(url)).not.toContain("synthetic-preflight-token");
    }
    expect(String(read.mock.calls[3]![0])).toContain(
      "2?fields=id%2Ctimestamp%2Cmedia%7Bid%2Cmedia_product_type%7D%2Cfrom",
    );
  });
  it.each([{}, { client_business_id: "999" }, { client_business_id: 6 }])(
    "rejects a missing, wrong or malformed client portfolio before account reads",
    async (business) => {
      configuration();
      const read = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(business));
      await expect(verifyControlledTarget(flags(), read)).rejects.toThrow();
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
  it("requires the exact reviewed commenter", async () => {
    configuration();
    await expect(
      verifyControlledTarget(
        flags(),
        fetcher(
          "FEED",
          new Date().toISOString(),
          "synthetic_account",
          "synthetic_other",
        ),
        "synthetic_commenter",
      ),
    ).rejects.toThrow("not eligible");
  });
  it.each(["LIVE", "STORY", "UNKNOWN"])(
    "rejects unsupported product %s",
    async (product) => {
      configuration();
      await expect(
        verifyControlledTarget(flags(), fetcher(product)),
      ).rejects.toThrow("not eligible");
    },
  );
  it("rejects expired comments rather than using notification time", async () => {
    configuration();
    await expect(
      verifyControlledTarget(
        flags(),
        fetcher("FEED", new Date(Date.now() - 8 * 86400000).toISOString()),
      ),
    ).rejects.toThrow("not eligible");
  });
  it("stops before media/comment requests when username differs", async () => {
    configuration();
    const read = fetcher("FEED", new Date().toISOString(), "other-account");
    await expect(verifyControlledTarget(flags(), read)).rejects.toThrow(
      "verification failed",
    );
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("rejects a commenter outside the controlled test allowlist", async () => {
    configuration();
    const read = fetcher(
      "FEED",
      new Date().toISOString(),
      "synthetic_account",
      "not-allowed",
    );
    await expect(verifyControlledTarget(flags(), read)).rejects.toThrow(
      "not eligible",
    );
  });
  it("keeps the private controlled entry point disabled before database access", async () => {
    vi.stubEnv("INSTAGRAM_DELIVERY_MODE", "disabled");
    expect(
      await runControlledDeliveryTest({} as PrismaClient, "not-needed"),
    ).toEqual({ state: "DISABLED" });
  });
  it("requires complete, short-lived approval and verified prerequisites", () => {
    const complete = flags();
    expect(complete.INSTAGRAM_DELIVERY_MODE).toBe("controlled_test");
    expect(() =>
      parseDeliverySettings({
        ...complete,
        INSTAGRAM_DELIVERY_APPROVED_UNTIL: new Date(
          Date.now() + 3600000,
        ).toISOString(),
      }),
    ).toThrow("fifteen minutes");
    expect(() =>
      parseDeliverySettings({
        ...complete,
        INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED: "0",
      }),
    ).toThrow("operator approval");
    expect(() =>
      parseDeliverySettings({ ...complete, JOBS_MODE: "development" }),
    ).toThrow("isolated local controls");
    expect(() =>
      parseDeliverySettings({
        ...complete,
        INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "1",
      }),
    ).toThrow("isolated local controls");
  });
});
