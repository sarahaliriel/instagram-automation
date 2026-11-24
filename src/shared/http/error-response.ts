import "server-only";
import {
  ApplicationError,
  type ApplicationErrorCode,
} from "@/shared/errors/application-error";

const errors: Record<
  ApplicationErrorCode,
  { status: number; message: string }
> = {
  INVALID_INPUT: { status: 400, message: "Invalid request." },
  UNAUTHORIZED: { status: 401, message: "Authentication required." },
  FORBIDDEN: { status: 403, message: "Access denied." },
  NOT_FOUND: { status: 404, message: "Resource not found." },
  CONFLICT: {
    status: 409,
    message: "Request conflicts with the current state.",
  },
  UNAVAILABLE: { status: 503, message: "Service temporarily unavailable." },
};

export function errorResponse(error: unknown): Response {
  const requestId = crypto.randomUUID();
  const code =
    error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
  const { status, message } =
    code === "INTERNAL_ERROR"
      ? { status: 500, message: "An unexpected error occurred." }
      : errors[code];
  // Allowlisted fields only. Never serialize errors, headers, payloads, or configuration.
  console.error(
    JSON.stringify({ event: "request_failed", code, status, requestId }),
  );
  return Response.json(
    { error: { code, message, requestId } },
    {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    },
  );
}
