import { describe, expect, it } from "vitest";
import { parseInstagramSettings } from "./settings-schema";
import { webhookConfig } from "../../../tests/fixtures/instagram";
const enabled = {
  INSTAGRAM_INTEGRATION_MODE: "development",
  META_WEBHOOK_APP_SECRET: webhookConfig.appSecret,
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: webhookConfig.verifyToken,
  INSTAGRAM_ACCOUNT_ID: webhookConfig.accountId,
};
describe("Instagram configuration", () => {
  it("defaults to disabled with no credentials", () =>
    expect(parseInstagramSettings({})).toMatchObject({
      INSTAGRAM_INTEGRATION_MODE: "disabled",
      INSTAGRAM_ADMIN_READ_MODE: "disabled",
    }));
  it("allows isolated development webhooks without an API token", () =>
    expect(
      parseInstagramSettings(enabled).META_SYSTEM_USER_ACCESS_TOKEN,
    ).toBeUndefined());
  it("rejects production activation even with credentials", () =>
    expect(() =>
      parseInstagramSettings({ ...enabled, NODE_ENV: "production" }),
    ).toThrow("forbidden"));
  it("allows administrative reads without enabling webhook secrets", () => {
    const result = parseInstagramSettings({
      INSTAGRAM_ADMIN_READ_MODE: "development",
      META_SYSTEM_USER_ACCESS_TOKEN: "synthetic",
      META_LOGIN_CONFIG_ID: "5",
      META_CLIENT_BUSINESS_ID: "6",
      INSTAGRAM_ACCOUNT_ID: "7",
    });
    expect(result).toMatchObject({
      INSTAGRAM_ADMIN_READ_MODE: "development",
      INSTAGRAM_INTEGRATION_MODE: "disabled",
    });
    expect("META_WEBHOOK_APP_SECRET" in result).toBe(false);
  });
  it("fails closed for incomplete or production administrative reads", () => {
    expect(() =>
      parseInstagramSettings({ INSTAGRAM_ADMIN_READ_MODE: "development" }),
    ).toThrow("META_SYSTEM_USER_ACCESS_TOKEN");
    expect(() =>
      parseInstagramSettings({
        NODE_ENV: "production",
        INSTAGRAM_ADMIN_READ_MODE: "development",
        META_SYSTEM_USER_ACCESS_TOKEN: "synthetic",
        META_LOGIN_CONFIG_ID: "5",
        META_CLIENT_BUSINESS_ID: "6",
        INSTAGRAM_ACCOUNT_ID: "7",
      }),
    ).toThrow("forbidden");
  });
  it("requires webhook secrets and authorized account when enabled", () =>
    expect(() =>
      parseInstagramSettings({ INSTAGRAM_INTEGRATION_MODE: "development" }),
    ).toThrow("META_WEBHOOK_APP_SECRET"));
  it("rejects unknown API versions and does not reveal invalid secrets", () => {
    expect(() =>
      parseInstagramSettings({ INSTAGRAM_API_VERSION: "v999.0" }),
    ).toThrow("INSTAGRAM_API_VERSION");
    try {
      parseInstagramSettings({ META_WEBHOOK_APP_SECRET: "secret" });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
  it("selects only Unified Login and rejects other integration models", () => {
    expect(parseInstagramSettings({}).INSTAGRAM_AUTH_MODEL).toBe(
      "unified_login",
    );
    for (const model of ["instagram_login", "facebook_login", "other"]) {
      expect(() =>
        parseInstagramSettings({ INSTAGRAM_AUTH_MODEL: model }),
      ).toThrow("INSTAGRAM_AUTH_MODEL");
    }
  });
  it("rejects the legacy token variable without including its value", () => {
    const value = "private-legacy-token";
    try {
      parseInstagramSettings({ INSTAGRAM_ACCESS_TOKEN: value });
      expect.fail("Expected rejection");
    } catch (error) {
      expect(String(error)).toContain("Legacy INSTAGRAM_ACCESS_TOKEN");
      expect(String(error)).not.toContain(value);
    }
  });
  it("requires configuration and business provenance with a SUAT", () => {
    expect(() =>
      parseInstagramSettings({ META_SYSTEM_USER_ACCESS_TOKEN: "synthetic" }),
    ).toThrow("META_LOGIN_CONFIG_ID");
    const result = parseInstagramSettings({
      META_SYSTEM_USER_ACCESS_TOKEN: "x".repeat(10000),
      META_LOGIN_CONFIG_ID: "5",
      META_CLIENT_BUSINESS_ID: "6",
    });
    expect(result.META_SYSTEM_USER_ACCESS_TOKEN).toHaveLength(10000);
  });
  it("reports invalid SUAT fields without exposing token contents", () => {
    try {
      parseInstagramSettings({
        META_SYSTEM_USER_ACCESS_TOKEN: "private token",
      });
      expect.fail("Expected rejection");
    } catch (error) {
      expect(String(error)).toContain("META_SYSTEM_USER_ACCESS_TOKEN");
      expect(String(error)).not.toContain("private token");
    }
  });
});
