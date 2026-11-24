import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAuthorizedInstagramClient,
  getAuthorizedInstagramReadClient,
} from "./authorized-client";
import { webhookConfig } from "../../../tests/fixtures/instagram";

function enable() {
  vi.stubEnv("INSTAGRAM_INTEGRATION_MODE", "development");
  vi.stubEnv("META_LOGIN_CONFIG_ID", "500000000000001");
  vi.stubEnv("META_CLIENT_BUSINESS_ID", "600000000000001");
  vi.stubEnv("META_WEBHOOK_APP_SECRET", webhookConfig.appSecret);
  vi.stubEnv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", webhookConfig.verifyToken);
  vi.stubEnv("INSTAGRAM_ACCOUNT_ID", webhookConfig.accountId);
}
function enableRead() {
  vi.stubEnv("INSTAGRAM_INTEGRATION_MODE", "disabled");
  vi.stubEnv("INSTAGRAM_ADMIN_READ_MODE", "development");
  vi.stubEnv("META_LOGIN_CONFIG_ID", "500000000000001");
  vi.stubEnv("META_CLIENT_BUSINESS_ID", "600000000000001");
  vi.stubEnv("INSTAGRAM_ACCOUNT_ID", webhookConfig.accountId);
  vi.stubEnv("META_SYSTEM_USER_ACCESS_TOKEN", "synthetic-test-token");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("server token integration", () => {
  it("does not create a client while integration is disabled", () => {
    vi.stubEnv("INSTAGRAM_INTEGRATION_MODE", "disabled");
    expect(() => getAuthorizedInstagramClient()).toThrow("configuration");
  });
  it("requires an injected Business Integration System User token for API operations", () => {
    enable();
    vi.stubEnv("META_SYSTEM_USER_ACCESS_TOKEN", undefined);
    expect(() => getAuthorizedInstagramClient()).toThrow("configuration");
  });
  it("makes no automatic requests and exposes no credentials", () => {
    enable();
    vi.stubEnv("META_SYSTEM_USER_ACCESS_TOKEN", "synthetic-test-token");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const client = getAuthorizedInstagramClient();
    expect(Object.keys(client)).toEqual([
      "getClientBusiness",
      "getClientBusinessPortfolio",
      "getSystemUserIdentity",
      "getAccount",
      "getCommentContext",
      "getTestCommentContext",
      "listMedia",
      "listDashboardMedia",
      "listOneMedia",
      "listOneMediaComments",
      "listManualMedia",
      "getManualMedia",
      "listManualComments",
      "subscribeComments",
    ]);
    expect(JSON.stringify(client)).not.toContain("synthetic-test-token");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("permits only bounded GET operations through the administrative read capability", async () => {
    enableRead();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ id: webhookConfig.accountId, username: "synthetic_account" }],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const client = getAuthorizedInstagramReadClient();
    expect(Object.keys(client)).toEqual(["getAccount", "listDashboardMedia"]);
    expect(JSON.stringify(client)).not.toContain("synthetic-test-token");
    await expect(client.getAccount()).resolves.toEqual({
      id: webhookConfig.accountId,
      username: "synthetic_account",
    });
    const [, init] = fetcher.mock.calls[0]!;
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
  });
  it("does not expose POST-capable client methods through read-only activation", () => {
    enableRead();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    expect(() => getAuthorizedInstagramClient()).toThrow("configuration");
    expect("subscribeComments" in getAuthorizedInstagramReadClient()).toBe(
      false,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed when administrative read configuration is missing", () => {
    vi.stubEnv("INSTAGRAM_ADMIN_READ_MODE", "development");
    expect(() => getAuthorizedInstagramReadClient()).toThrow();
  });
});
