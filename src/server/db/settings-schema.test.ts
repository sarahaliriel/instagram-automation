import { describe, expect, it } from "vitest";
import { parsePersistenceSettings } from "./settings-schema";
const enabled = {
  DATABASE_URL: "postgresql://localhost/fixture_test",
  EVENT_ENCRYPTION_KEY: "a".repeat(64),
  JOBS_MODE: "development",
  INNGEST_DEV: "1",
};
describe("persistence environment validation", () => {
  it("keeps jobs off by default and needs no database for disabled builds", () =>
    expect(parsePersistenceSettings({}).JOBS_MODE).toBe("disabled"));
  it("does not activate jobs or ingestion for administrative reads", () =>
    expect(
      parsePersistenceSettings({
        INSTAGRAM_ADMIN_READ_MODE: "development",
      }),
    ).toMatchObject({ JOBS_MODE: "disabled" }));
  it("requires durable configuration when ingestion is enabled", () =>
    expect(() =>
      parsePersistenceSettings({ INSTAGRAM_INTEGRATION_MODE: "development" }),
    ).toThrow("DATABASE_URL"));
  it("requires explicit local job mode and forbids production activation", () => {
    expect(parsePersistenceSettings(enabled).JOBS_MODE).toBe("development");
    expect(() =>
      parsePersistenceSettings({ ...enabled, INNGEST_DEV: "0" }),
    ).toThrow("INNGEST_DEV");
    expect(() =>
      parsePersistenceSettings({ ...enabled, NODE_ENV: "production" }),
    ).toThrow("non-production");
  });
  it("never includes invalid credential values in errors", () => {
    expect(() =>
      parsePersistenceSettings({ EVENT_ENCRYPTION_KEY: "invalid-private-key" }),
    ).toThrow("EVENT_ENCRYPTION_KEY");
    try {
      parsePersistenceSettings({ DATABASE_URL: "invalid-private-password" });
    } catch (error) {
      expect(String(error)).not.toContain("invalid-private-password");
    }
  });
});
