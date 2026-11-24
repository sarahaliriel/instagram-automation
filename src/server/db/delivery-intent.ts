import "server-only";
import { z } from "zod";
import { messageTemplateSchema } from "@/modules/automations/rule-schema";
import { encryptCommentText, decryptCommentText } from "./encryption";
import { StoredEventError } from "@/server/jobs/retry-policy";

const schema = z
  .object({
    version: z.literal(1),
    engineVersion: z.literal("matching-v1"),
    ruleId: z.uuid(),
    keywordId: z.uuid(),
    strategy: z.enum(["EXACT", "WHOLE_WORD"]),
    scope: z.enum(["GLOBAL", "MEDIA"]),
    priority: z.number().int(),
    normalizedKeyword: z.string().min(1),
    accountId: z.string().regex(/^\d{1,64}$/),
    commentId: z.string().regex(/^\d{1,64}$/),
    privateMessage: messageTemplateSchema,
    publicFallbackMessage: messageTemplateSchema.nullable(),
  })
  .strict();
export type DeliveryIntent = z.infer<typeof schema>;
function context(executionId: string) {
  return JSON.stringify(["automation.delivery-intent.v1", executionId]);
}
export function encryptDeliveryIntent(
  executionId: string,
  input: DeliveryIntent,
  key: string,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new StoredEventError();
  return encryptCommentText(
    JSON.stringify(parsed.data),
    key,
    context(executionId),
  );
}
// Future delivery code must load the canonical execution, recheck authorization
// and delivery policy, and use a separate attempt ledger before invoking an adapter.
export function decryptDeliveryIntent(
  executionId: string,
  ciphertext: string,
  key: string,
): DeliveryIntent {
  try {
    return schema.parse(
      JSON.parse(decryptCommentText(ciphertext, key, context(executionId))),
    );
  } catch {
    throw new StoredEventError();
  }
}
