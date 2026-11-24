import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env-schema";

describe("environment validation", () => {
  it("supports local development without credentials", () => {
    expect(parseEnvironment({})).toEqual({
      NODE_ENV: "development",
      APP_URL: "http://localhost:3000",
    });
  });
  it("accepts a production HTTPS origin", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "production",
        APP_URL: "https://app.example.com",
      }).APP_URL,
    ).toBe("https://app.example.com");
  });
  it.each([
    "",
    "invalid",
    "ftp://example.com",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?token=secret",
    "https://example.com/#fragment",
  ])("rejects unsafe origins: %s", (APP_URL) => {
    expect(() => parseEnvironment({ APP_URL })).toThrow("APP_URL");
  });
  it("requires HTTPS in production", () => {
    expect(() => parseEnvironment({ NODE_ENV: "production" })).toThrow(
      "APP_URL",
    );
  });
  it("reports field names without input values", () => {
    expect(() => parseEnvironment({ NODE_ENV: "private-secret" })).toThrow(
      "NODE_ENV",
    );
    try {
      parseEnvironment({ APP_URL: "private-secret" });
    } catch (error) {
      expect(String(error)).not.toContain("private-secret");
    }
  });
});
