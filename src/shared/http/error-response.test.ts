import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "@/shared/errors/application-error";
import { errorResponse } from "./error-response";

describe("safe API errors", () => {
  it.each([
    ["INVALID_INPUT", 400],
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["UNAVAILABLE", 503],
  ] as const)(
    "maps %s to HTTP %i without exposing internal details",
    async (code, status) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = errorResponse(
        new ApplicationError(code, "private-token"),
      );
      const body = await response.json();
      expect(response.status).toBe(status);
      expect(body.error.code).toBe(code);
      expect(body.error.requestId).toBe(response.headers.get("X-Request-Id"));
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(JSON.stringify(body)).not.toContain("private-token");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
    },
  );
  it("redacts unknown errors from responses and structured logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = errorResponse(
      new Error("Bearer secret; comment: personal data"),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
    expect(Object.keys(JSON.parse(log.mock.calls[0]![0]))).toEqual([
      "event",
      "code",
      "status",
      "requestId",
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("personal data");
  });
});
