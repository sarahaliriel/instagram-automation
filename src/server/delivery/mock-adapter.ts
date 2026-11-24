import "server-only";
import type {
  InstagramMessagingAdapter,
  MessagingOutcome,
} from "@/modules/instagram/messaging-adapter";
// The worker additionally requires a real PostgreSQL database ending _test.
export function createMockMessagingAdapter(
  privateOutcome: MessagingOutcome = {
    kind: "API_ACCEPTED",
    operationId: "synthetic-private-operation",
    delivery: "UNCONFIRMED",
  },
  publicOutcome: MessagingOutcome = {
    kind: "API_ACCEPTED",
    operationId: "synthetic-public-operation",
    delivery: "UNCONFIRMED",
  },
): InstagramMessagingAdapter {
  return Object.freeze({
    transport: "MOCK" as const,
    async sendAuthorizedPrivateReply() {
      return privateOutcome;
    },
    async sendAuthorizedPublicReply() {
      return publicOutcome;
    },
  });
}
