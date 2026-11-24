// idempotencyKey identifies our ledger, not a claimed Meta idempotency feature.
export type MessagingOutcome =
  | { kind: "API_ACCEPTED"; operationId: string; delivery: "UNCONFIRMED" }
  | {
      kind: "API_REJECTED";
      reason:
        | "AUTHENTICATION"
        | "AUTHORIZATION"
        | "POLICY"
        | "INVALID_INPUT"
        | "RATE_LIMIT"
        | "OTHER";
      safeToRetry: boolean;
      httpStatus?: number;
      metaCode?: number;
      metaSubcode?: number;
      retryAfterMs?: number;
    }
  | {
      kind: "TEMPORARY_FAILURE";
      requestOutcome: "NOT_SUBMITTED";
      retryAfterMs?: number;
    }
  | { kind: "UNKNOWN"; requiresManualReview: true }
  // Only produced by the isolated mock adapter, never by the Meta HTTP classifier.
  | { kind: "SIMULATED_ELIGIBLE_REJECTION" };
export type AuthorizedPrivateReply = {
  accountId: string;
  commentId: string;
  message: string;
  idempotencyKey: string;
};
export type AuthorizedPublicReply = AuthorizedPrivateReply & {
  authorization: {
    kind: "CONFIRMED_ELIGIBLE_PRIVATE_REPLY_REJECTION";
    evidenceId: string;
  };
};
export interface InstagramMessagingAdapter {
  readonly transport: "MOCK" | "META";
  sendAuthorizedPrivateReply(
    input: AuthorizedPrivateReply,
  ): Promise<MessagingOutcome>;
  sendAuthorizedPublicReply(
    input: AuthorizedPublicReply,
  ): Promise<MessagingOutcome>;
}
