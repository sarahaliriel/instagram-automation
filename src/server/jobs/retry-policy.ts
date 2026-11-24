export const MAX_PROCESSING_ATTEMPTS = 5;
export const LEASE_MS = 120_000;
export const REDISPATCH_MS = 180_000;

export function retryDelayMs(attempt: number) {
  return Math.min(
    15 * 60_000,
    1000 * 2 ** Math.min(Math.max(attempt - 1, 0), 10),
  );
}
export function classifyProcessingError(
  error: unknown,
): "FAILED_RETRYABLE" | "FAILED_PERMANENT" | "UNKNOWN" {
  if (error instanceof TemporalEvidencePendingError) return "FAILED_RETRYABLE";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (
    [
      "P1001",
      "P1002",
      "P1008",
      "P1017",
      "P2024",
      "P2028",
      "P2034",
      "40001",
      "40P01",
      "55P03",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
    ].includes(code) ||
    code.startsWith("08")
  )
    return "FAILED_RETRYABLE";
  if (error instanceof StoredEventError) return "FAILED_PERMANENT";
  return "UNKNOWN";
}
export class TemporalEvidencePendingError extends Error {
  constructor() {
    super("Comment creation evidence is not available");
  }
}
export class TemporalEvidenceReviewError extends Error {
  constructor() {
    super("Temporal evidence requires review");
  }
}
export class StoredEventError extends Error {
  constructor() {
    super("Stored event validation failed");
  }
}
export class ProcessingRetryableError extends Error {
  constructor() {
    super("Event processing temporarily unavailable");
  }
}
