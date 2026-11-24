import { describe, expect, it } from "vitest";
import { parseDeliverySettings } from "./settings-schema";
import { withinReplyWindow } from "./preflight";
import {
  fallbackEligibility,
  DEFAULT_PUBLIC_FALLBACK,
} from "./fallback-policy";
describe("delivery controls and policy", () => {
  it("defaults to disabled and rejects production activation", () => {
    expect(parseDeliverySettings({}).INSTAGRAM_DELIVERY_MODE).toBe("disabled");
    for (const mode of ["mock", "controlled_test"])
      expect(() =>
        parseDeliverySettings({
          NODE_ENV: "production",
          INSTAGRAM_DELIVERY_MODE: mode,
        }),
      ).toThrow("forbidden");
  });
  it("does not activate delivery or fallback for administrative reads", () =>
    expect(
      parseDeliverySettings({
        INSTAGRAM_ADMIN_READ_MODE: "development",
      }),
    ).toMatchObject({
      INSTAGRAM_DELIVERY_MODE: "disabled",
      INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "0",
    }));
  it("rejects incomplete controls without including supplied values", () => {
    expect(() =>
      parseDeliverySettings({ INSTAGRAM_DELIVERY_MODE: "controlled_test" }),
    ).toThrow("explicit target");
    expect(() =>
      parseDeliverySettings({
        INSTAGRAM_DELIVERY_APPROVAL_ID: "private-invalid-value",
      }),
    ).toThrow("Invalid delivery configuration");
  });
  it("never enables real fallback based on a simulated rejection", () => {
    expect(
      fallbackEligibility(
        { kind: "SIMULATED_ELIGIBLE_REJECTION" },
        "CONTROLLED_TEST",
      ),
    ).toBeNull();
    expect(
      fallbackEligibility({ kind: "SIMULATED_ELIGIBLE_REJECTION" }, "MOCK"),
    ).toBe("SYNTHETIC_TEST_ONLY");
    for (const reason of [
      "AUTHENTICATION",
      "AUTHORIZATION",
      "POLICY",
      "RATE_LIMIT",
      "OTHER",
    ] as const)
      expect(
        fallbackEligibility(
          { kind: "API_REJECTED", reason, safeToRetry: false },
          "MOCK",
        ),
      ).toBeNull();
    expect(
      fallbackEligibility(
        { kind: "UNKNOWN", requiresManualReview: true },
        "MOCK",
      ),
    ).toBeNull();
    expect(DEFAULT_PUBLIC_FALLBACK).toContain("FORMULÁRIO");
    expect(DEFAULT_PUBLIC_FALLBACK).not.toContain("conta privada");
  });
  it("uses creation time and allows only post/reel comments strictly within seven days", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(
      withinReplyWindow(new Date(now.getTime() - 86400000), "FEED", now),
    ).toBe(true);
    expect(
      withinReplyWindow(new Date(now.getTime() - 7 * 86400000), "REELS", now),
    ).toBe(false);
    expect(withinReplyWindow(now, "LIVE", now)).toBe(false);
    expect(withinReplyWindow(new Date(now.getTime() + 1), "FEED", now)).toBe(
      false,
    );
    expect(withinReplyWindow(new Date("invalid"), "FEED", now)).toBe(false);
  });
});
