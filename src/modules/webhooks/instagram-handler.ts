import "server-only";
import {
  BodyTooLargeError,
  readLimitedBody,
} from "@/shared/http/read-limited-body";
import {
  parseInstagramEvents,
  type ParsedInstagramEvents,
  type InstagramCommentEvent,
} from "./comment-events";
import { equalSecret, verifyInstagramSignature } from "./signature";

export type DevelopmentWebhookConfiguration = {
  appSecret: string;
  verifyToken: string;
  accountId: string;
};
const headers = { "Cache-Control": "no-store" };
const maxBytes = 1024 * 1024;
function reply(status: number, code: string) {
  return Response.json({ status: code }, { status, headers });
}

export function verifyWebhook(
  request: Request,
  config: DevelopmentWebhookConfiguration,
) {
  const query = new URL(request.url).searchParams;
  const token = query.get("hub.verify_token");
  if (
    query.getAll("hub.mode").length !== 1 ||
    query.get("hub.mode") !== "subscribe" ||
    query.getAll("hub.verify_token").length !== 1 ||
    !token ||
    !equalSecret(token, config.verifyToken)
  )
    return reply(403, "verification_failed");
  const challenge = query.get("hub.challenge");
  if (
    query.getAll("hub.challenge").length !== 1 ||
    !challenge ||
    !/^\d{1,128}$/.test(challenge)
  )
    return reply(400, "invalid_challenge");
  return new Response(challenge, {
    status: 200,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function receiveWebhook(
  request: Request,
  config: DevelopmentWebhookConfiguration,
  accept?: (events: InstagramCommentEvent[]) => Promise<void>,
) {
  // Reject absent or malformed signatures before reading any untrusted body.
  const signature = request.headers.get("x-hub-signature-256");
  if (!signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature))
    return reply(401, "invalid_signature");
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody(request.body, maxBytes);
  } catch (error) {
    return reply(
      error instanceof BodyTooLargeError ? 413 : 400,
      "invalid_body",
    );
  }
  if (!verifyInstagramSignature(bytes, signature, config.appSecret))
    return reply(401, "invalid_signature");
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return reply(415, "unsupported_content_type");
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return reply(400, "invalid_json");
  }
  let events: ParsedInstagramEvents;
  try {
    events = parseInstagramEvents(payload, config.accountId, config.appSecret);
  } catch {
    return reply(400, "invalid_event");
  }
  if (events.comments.length === 0)
    return reply(200, "ignored_unsupported_event");
  try {
    if (!accept) throw new Error("Durable ingestion unavailable");
    await accept(events.comments);
    return reply(200, "accepted");
  } catch {
    // No payload, usernames, IDs, connection strings or raw exceptions in logs.
    if (accept)
      console.error(JSON.stringify({ event: "webhook_persistence_failed" }));
    return Response.json(
      { status: "durable_ingestion_unavailable" },
      { status: 503, headers: { ...headers, "Retry-After": "60" } },
    );
  }
}
