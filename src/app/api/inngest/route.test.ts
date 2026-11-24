import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("local job callback boundary", () => {
  it("keeps all callback methods disabled without executing provider work", async () => {
    vi.stubEnv("JOBS_MODE", "disabled");
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    for (const handler of [GET, POST, PUT])
      expect(
        (await handler(new NextRequest("http://localhost/api/inngest"), {}))
          .status,
      ).toBe(503);
    expect(network).not.toHaveBeenCalled();
  });
  it("refuses external callback hostnames even in enabled local development", async () => {
    vi.stubEnv("JOBS_MODE", "development");
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/fixture_test");
    vi.stubEnv("EVENT_ENCRYPTION_KEY", "a".repeat(64));
    expect(
      (await GET(new NextRequest("https://public.example.com/api/inngest"), {}))
        .status,
    ).toBe(503);
  });
  it("fails closed on forbidden production job configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JOBS_MODE", "development");
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/fixture_test");
    vi.stubEnv("EVENT_ENCRYPTION_KEY", "a".repeat(64));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (
        await POST(
          new NextRequest("http://localhost/api/inngest", { method: "POST" }),
          {},
        )
      ).status,
    ).toBe(500);
  });
});
