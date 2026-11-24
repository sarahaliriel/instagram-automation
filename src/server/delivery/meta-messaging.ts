import "server-only";
import { z } from "zod";
import { readLimitedBody } from "@/shared/http/read-limited-body";
import {
  encodeReply,
  parseReplyAcceptance,
  replyRequestSchema,
} from "./message-protocol";
import { apiVersionSchema } from "@/modules/instagram/settings-schema";
import type { BusinessIntegrationCredential } from "@/modules/instagram/client";
import type {
  InstagramMessagingAdapter,
  MessagingOutcome,
  AuthorizedPrivateReply,
  AuthorizedPublicReply,
} from "@/modules/instagram/messaging-adapter";
import { getDeliverySettings } from "./settings";

const id = z.string().regex(/^\d{1,64}$/);
const failureSchema = z.object({
  error: z.object({
    code: z.number().int(),
    error_subcode: z.number().int().optional(),
    is_transient: z.boolean().optional(),
  }),
});
export function classifyMessagingRejection(
  status: number,
  code: number,
  subcode?: number,
  transient = false,
  retryAfterMs?: number,
): MessagingOutcome {
  // A write may have happened before a server/proxy failure; never retry this automatically.
  if (
    status < 400 ||
    status >= 500 ||
    status === 408 ||
    transient ||
    [1, 2].includes(code)
  )
    return { kind: "UNKNOWN", requiresManualReview: true };
  const reason =
    status === 401 || code === 190
      ? "AUTHENTICATION"
      : status === 403 || code === 10 || (code >= 200 && code <= 299)
        ? "AUTHORIZATION"
        : status === 429 || [4, 17, 32, 613, 80002].includes(code)
          ? "RATE_LIMIT"
          : code === 368
            ? "POLICY"
            : code === 100
              ? "INVALID_INPUT"
              : "OTHER";
  return {
    kind: "API_REJECTED",
    reason,
    safeToRetry: reason === "RATE_LIMIT",
    httpStatus: status,
    metaCode: code,
    ...(subcode === undefined ? {} : { metaSubcode: subcode }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}
// This adapter has no automatic callers in controlled mode. Every request rechecks the flags.
export function createMetaMessagingAdapter(
  options: {
    apiVersion: "v26.0" | "v27.0";
    credential: BusinessIntegrationCredential;
    executionId: string;
    approvalId: string;
    timeoutMs?: number;
  },
  fetcher: typeof fetch = fetch,
): InstagramMessagingAdapter {
  const checked = z
    .object({
      apiVersion: apiVersionSchema,
      executionId: z.uuid(),
      approvalId: z.uuid(),
      timeoutMs: z.number().int().min(1).max(30000).default(10000),
      credential: z
        .object({
          kind: z.literal("business_integration_system_user"),
          accessToken: z.string().min(1).regex(/^\S+$/),
          configId: id,
          clientBusinessId: id,
        })
        .strict(),
    })
    .safeParse(options);
  if (!checked.success) throw new Error("Invalid messaging configuration");
  const config = checked.data;
  async function send(
    input: AuthorizedPrivateReply,
    kind: "PRIVATE_REPLY" | "PUBLIC_FALLBACK",
  ): Promise<MessagingOutcome> {
    const parsed = replyRequestSchema.safeParse(input);
    if (!parsed.success)
      return {
        kind: "API_REJECTED",
        reason: "INVALID_INPUT",
        safeToRetry: false,
      };
    let flags;
    try {
      flags = getDeliverySettings();
    } catch {
      return {
        kind: "API_REJECTED",
        reason: "AUTHORIZATION",
        safeToRetry: false,
      };
    }
    if (
      flags.INSTAGRAM_DELIVERY_MODE !== "controlled_test" ||
      flags.INSTAGRAM_DELIVERY_EXECUTION_ID !== config.executionId ||
      flags.INSTAGRAM_DELIVERY_APPROVAL_ID !== config.approvalId ||
      flags.INSTAGRAM_DELIVERY_ACCOUNT_ID !== input.accountId ||
      flags.INSTAGRAM_DELIVERY_COMMENT_ID !== input.commentId
    )
      return {
        kind: "API_REJECTED",
        reason: "AUTHORIZATION",
        safeToRetry: false,
      };
    // Live fallback remains blocked until an exact documented rejection policy is reviewed.
    if (kind === "PUBLIC_FALLBACK")
      return {
        kind: "API_REJECTED",
        reason: "AUTHORIZATION",
        safeToRetry: false,
      };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const { path, body } = encodeReply(kind, parsed.data);
      const response = await fetcher(
        new URL(`https://graph.facebook.com/${config.apiVersion}/${path}`),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.credential.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );
      const payload: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readLimitedBody(response.body, 1024 * 1024),
        ),
      );
      const failure = failureSchema.safeParse(payload);
      if (failure.success) {
        if (response.ok) return { kind: "UNKNOWN", requiresManualReview: true };
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : retryAfter === null
            ? NaN
            : Date.parse(retryAfter) - Date.now();
        // Never shorten a provider cooldown. An unrepresentable/very long cooldown needs review.
        if (
          retryAfter !== null &&
          (!Number.isFinite(delay) || delay > 30 * 86400000)
        )
          return { kind: "UNKNOWN", requiresManualReview: true };
        return classifyMessagingRejection(
          response.status,
          failure.data.error.code,
          failure.data.error.error_subcode,
          failure.data.error.is_transient,
          Number.isFinite(delay) && delay > 0 ? delay : undefined,
        );
      }
      if (!response.ok) return { kind: "UNKNOWN", requiresManualReview: true };
      return parseReplyAcceptance(kind, payload);
    } catch {
      // Timeout, redirect, truncated body, invalid JSON and network errors all have unknown write outcomes.
      return { kind: "UNKNOWN", requiresManualReview: true };
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    transport: "META" as const,
    sendAuthorizedPrivateReply: (input: AuthorizedPrivateReply) =>
      send(input, "PRIVATE_REPLY"),
    async sendAuthorizedPublicReply(
      input: AuthorizedPublicReply,
    ): Promise<MessagingOutcome> {
      const parsed = z
        .object({
          kind: z.literal("CONFIRMED_ELIGIBLE_PRIVATE_REPLY_REJECTION"),
          evidenceId: z.uuid(),
        })
        .strict()
        .safeParse(input.authorization);
      if (!parsed.success)
        return {
          kind: "API_REJECTED",
          reason: "AUTHORIZATION",
          safeToRetry: false,
        };
      const { authorization: _authorization, ...reply } = input;
      void _authorization;
      return send(reply, "PUBLIC_FALLBACK");
    },
  });
}
