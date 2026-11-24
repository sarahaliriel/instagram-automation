import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("returns uncached liveness without configuration or integration details", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });
  it("returns a safe error for invalid configuration", async () => {
    vi.stubEnv("APP_URL", "secret-invalid-value");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = GET();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-invalid-value");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "secret-invalid-value",
    );
  });
});
