import { describe, expect, it } from "vitest";
import {
  encodeReply,
  parseReplyAcceptance,
  replyRequestSchema,
} from "./message-protocol";
describe("official reply request/response contracts", () => {
  it("encodes public comment replies without inventing a private endpoint", () => {
    const input = replyRequestSchema.parse({
      accountId: "1",
      commentId: "2",
      message: "Synthetic public reply",
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
    });
    expect(encodeReply("PUBLIC_FALLBACK", input)).toEqual({
      path: "2/replies",
      body: { message: "Synthetic public reply" },
    });
    expect(
      parseReplyAcceptance("PUBLIC_FALLBACK", {
        id: "3",
        private_data: "discard",
      }),
    ).toEqual({
      kind: "API_ACCEPTED",
      operationId: "3",
      delivery: "UNCONFIRMED",
    });
    expect(
      parseReplyAcceptance("PUBLIC_FALLBACK", { success: true }),
    ).toMatchObject({ kind: "UNKNOWN" });
  });
});
