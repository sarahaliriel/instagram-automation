import "server-only";
import { z } from "zod";
import { messageTemplateSchema } from "@/modules/automations/rule-schema";
import type { MessagingOutcome } from "@/modules/instagram/messaging-adapter";
const id = z.string().regex(/^\d{1,64}$/);
export const replyRequestSchema = z
  .object({
    accountId: id,
    commentId: id,
    message: messageTemplateSchema,
    idempotencyKey: z.uuid(),
  })
  .strict();
export type ReplyKind = "PRIVATE_REPLY" | "PUBLIC_FALLBACK";
export function encodeReply(
  kind: ReplyKind,
  input: z.infer<typeof replyRequestSchema>,
) {
  return kind === "PRIVATE_REPLY"
    ? {
        path: `${input.accountId}/messages`,
        body: {
          recipient: { comment_id: input.commentId },
          message: { text: input.message },
        },
      }
    : { path: `${input.commentId}/replies`, body: { message: input.message } };
}
export function parseReplyAcceptance(
  kind: ReplyKind,
  payload: unknown,
): MessagingOutcome {
  if (kind === "PRIVATE_REPLY") {
    const result = z
      .object({ recipient_id: id, message_id: z.string().min(1).max(4096) })
      .safeParse(payload);
    return result.success
      ? {
          kind: "API_ACCEPTED",
          operationId: result.data.message_id,
          delivery: "UNCONFIRMED",
        }
      : { kind: "UNKNOWN", requiresManualReview: true };
  }
  const result = z.object({ id }).safeParse(payload);
  return result.success
    ? {
        kind: "API_ACCEPTED",
        operationId: result.data.id,
        delivery: "UNCONFIRMED",
      }
    : { kind: "UNKNOWN", requiresManualReview: true };
}
