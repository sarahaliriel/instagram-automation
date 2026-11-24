import { describe, expect, it } from "vitest";
import {
  classifyProcessingError,
  retryDelayMs,
  StoredEventError,
  TemporalEvidencePendingError,
  TemporalEvidenceReviewError,
} from "./retry-policy";
describe("database-only retry policy", () => {
  it.each(["P1001", "P2024", "P2034", "40001", "40P01", "08006"])(
    "retries known transient code %s",
    (code) =>
      expect(classifyProcessingError({ code })).toBe("FAILED_RETRYABLE"),
  );
  it("routes invalid stored events to permanent failure and unknown bugs to review", () => {
    expect(classifyProcessingError(new StoredEventError())).toBe(
      "FAILED_PERMANENT",
    );
    expect(classifyProcessingError(new Error("untrusted details"))).toBe(
      "UNKNOWN",
    );
  });
  it("retries missing evidence and sends contradictory evidence to review", () => {
    expect(classifyProcessingError(new TemporalEvidencePendingError())).toBe(
      "FAILED_RETRYABLE",
    );
    expect(classifyProcessingError(new TemporalEvidenceReviewError())).toBe(
      "UNKNOWN",
    );
  });
  it("uses capped exponential backoff", () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(3)).toBe(4000);
    expect(retryDelayMs(100)).toBe(900000);
  });
});
