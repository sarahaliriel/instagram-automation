import { afterEach, describe, expect, it, vi } from "vitest";
import { webhookConfig } from "../../../../../tests/fixtures/instagram";
import { GET, POST } from "./route";

afterEach(() => vi.unstubAllEnvs());
describe("webhook deployment gate", () => {
  it("refuses production activation even with valid webhook credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INSTAGRAM_INTEGRATION_MODE", "development");
    vi.stubEnv("META_WEBHOOK_APP_SECRET", webhookConfig.appSecret);
    vi.stubEnv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", webhookConfig.verifyToken);
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", webhookConfig.accountId);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(GET(new Request("https://example.com")).status).toBe(500);
    expect((await POST(new Request("https://example.com"))).status).toBe(500);
  });
  it("returns 503 for GET and POST when disabled", async () => {
    vi.stubEnv("INSTAGRAM_INTEGRATION_MODE", "disabled");
    const request = new Request("https://example.com/api/webhooks/instagram");
    expect(GET(request).status).toBe(503);
    expect((await POST(request)).status).toBe(503);
  });
  it("keeps GET challenge and POST ingestion disabled when only administrative reads are enabled", async () => {
    vi.stubEnv("INSTAGRAM_INTEGRATION_MODE", "disabled");
    vi.stubEnv("INSTAGRAM_ADMIN_READ_MODE", "development");
    vi.stubEnv("META_SYSTEM_USER_ACCESS_TOKEN", "synthetic-test-token");
    vi.stubEnv("META_LOGIN_CONFIG_ID", "500000000000001");
    vi.stubEnv("META_CLIENT_BUSINESS_ID", "600000000000001");
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", webhookConfig.accountId);
    const request = new Request("https://example.com/api/webhooks/instagram");
    expect(GET(request).status).toBe(503);
    expect((await POST(request)).status).toBe(503);
  });
  it("fails closed on invalid settings without leaking credentials", async () => {
    vi.stubEnv("INSTAGRAM_INTEGRATION_MODE", "development");
    vi.stubEnv("META_WEBHOOK_APP_SECRET", "private-secret");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = GET(new Request("https://example.com"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-secret");
  });
});
