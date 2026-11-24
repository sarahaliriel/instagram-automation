import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";

const id = z.string().regex(/^\d{1,64}$/);
const changeSchema = z.object({ field: z.string().min(1), value: z.unknown() });
const entrySchema = z
  .object({
    id,
    time: z.number().int().nonnegative().safe(),
    changes: z.array(changeSchema).max(1000).optional(),
    field: z.never().optional(),
    value: z.never().optional(),
    // Messaging is unsupported, but must not turn a malformed comment into an ignored event.
    messaging: z.array(z.unknown()).max(1000).optional(),
  })
  .superRefine((entry, context) => {
    const shapes =
      Number(entry.changes !== undefined) +
      Number(entry.messaging !== undefined);
    if (shapes !== 1 || "field" in entry || "value" in entry) {
      context.addIssue({
        code: "custom",
        message: "Expected exactly one documented event container",
      });
    }
  });
const envelopeSchema = z.object({
  object: z.string().min(1),
  entry: z.array(z.unknown()).max(1000),
});
const commentSchema = z.object({
  comment_id: id,
  // Reject mixed-model identifiers instead of silently interpreting an old payload.
  id: z.never().optional(),
  text: z.string().max(100000).optional(),
  from: z
    .object({
      id,
      username: z.string().optional(),
      self_ig_scoped_id: id.optional(),
    })
    .optional(),
  media: z.object({ id, media_product_type: z.string().optional() }),
  parent_id: id.optional(),
});

export type InstagramCommentEvent = {
  eventId: string;
  accountId: string;
  commentId: string;
  mediaId: string;
  notificationTime: number;
  text?: string;
  authorId?: string;
  parentCommentId?: string;
};
export type ParsedInstagramEvents = {
  comments: InstagramCommentEvent[];
  ignoredCount: number;
};

// This identifier is a candidate for later persistent uniqueness, not an idempotency implementation.
export function commentEventId(
  accountId: string,
  commentId: string,
  identifierKey: string,
): string {
  return createHmac("sha256", identifierKey)
    .update(JSON.stringify(["instagram.comments.v1", accountId, commentId]))
    .digest("hex");
}

export function parseInstagramEvents(
  payload: unknown,
  accountId: string,
  identifierKey: string,
): ParsedInstagramEvents {
  const envelopes = z
    .array(envelopeSchema)
    .min(1)
    .max(1000)
    .parse(Array.isArray(payload) ? payload : [payload]);
  const result: ParsedInstagramEvents = { comments: [], ignoredCount: 0 };
  for (const envelope of envelopes) {
    if (envelope.object !== "instagram") {
      result.ignoredCount += 1;
      continue;
    }
    for (const input of envelope.entry) {
      const entry = entrySchema.parse(input);
      // A valid signature authenticates the app, not this application's authorized account.
      if (entry.id !== accountId)
        throw new Error("Unexpected Instagram account");
      if (entry.messaging) {
        result.ignoredCount += entry.messaging.length;
        continue;
      }
      const changes = entry.changes ?? [];
      for (const change of changes) {
        if (change.field !== "comments") {
          result.ignoredCount += 1;
          continue;
        }
        const value = commentSchema.parse(change.value);
        result.comments.push({
          eventId: commentEventId(entry.id, value.comment_id, identifierKey),
          accountId: entry.id,
          commentId: value.comment_id,
          mediaId: value.media.id,
          notificationTime: entry.time,
          ...(value.text === undefined ? {} : { text: value.text }),
          ...(value.from === undefined ? {} : { authorId: value.from.id }),
          ...(value.parent_id === undefined
            ? {}
            : { parentCommentId: value.parent_id }),
        });
      }
    }
  }
  return result;
}
