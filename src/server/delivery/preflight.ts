import "server-only";
import { createInstagramClient } from "@/modules/instagram/client";
import { getInstagramSettings } from "@/modules/instagram/settings";
import type { DeliverySettings } from "./settings-schema";

const CONTROLLED_TEST_COMMENTERS = new Set([
  "synthetic_commenter",
  "synthetic_other",
]);

export function withinReplyWindow(
  createdAt: Date,
  product: string,
  now = new Date(),
) {
  const age = now.getTime() - createdAt.getTime();
  // MVP: posts/reels only. Notification time is never used as comment creation time.
  return (
    ["FEED", "REELS"].includes(product) &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < 7 * 24 * 3600_000
  );
}
export async function verifyControlledTarget(
  flags: DeliverySettings,
  fetcher: typeof fetch = fetch,
  expectedCommenter?: "synthetic_commenter" | "synthetic_other",
) {
  const config = getInstagramSettings();
  if (
    !config.META_SYSTEM_USER_ACCESS_TOKEN ||
    !config.META_CLIENT_BUSINESS_ID ||
    !config.META_LOGIN_CONFIG_ID ||
    config.INSTAGRAM_ACCOUNT_ID !== flags.INSTAGRAM_DELIVERY_ACCOUNT_ID
  )
    throw new Error("Controlled delivery credentials unavailable");
  const client = createInstagramClient(
    {
      apiVersion: config.INSTAGRAM_API_VERSION,
      accountId: config.INSTAGRAM_ACCOUNT_ID!,
      credential: {
        kind: "business_integration_system_user",
        accessToken: config.META_SYSTEM_USER_ACCESS_TOKEN,
        clientBusinessId: config.META_CLIENT_BUSINESS_ID,
        configId: config.META_LOGIN_CONFIG_ID,
      },
    },
    fetcher,
  );
  await client.getClientBusinessPortfolio();
  const account = await client.getAccount();
  if (account.username.toLowerCase() !== "synthetic_account")
    throw new Error("Target verification failed");
  const media = await client.listMedia();
  if (!media.data.some((item) => item.id === flags.INSTAGRAM_DELIVERY_MEDIA_ID))
    throw new Error("Target media unavailable on first page");
  const comment = await client.getTestCommentContext(
    flags.INSTAGRAM_DELIVERY_COMMENT_ID!,
  );
  const createdAt = new Date(comment.timestamp);
  if (
    comment.id !== flags.INSTAGRAM_DELIVERY_COMMENT_ID ||
    comment.media.id !== flags.INSTAGRAM_DELIVERY_MEDIA_ID ||
    !CONTROLLED_TEST_COMMENTERS.has(comment.from.username.toLowerCase()) ||
    (expectedCommenter !== undefined &&
      comment.from.username.toLowerCase() !== expectedCommenter) ||
    !withinReplyWindow(createdAt, comment.media.media_product_type)
  )
    throw new Error("Target comment is not eligible");
  return {
    createdAt,
    product: comment.media.media_product_type,
    verifiedAt: new Date(),
  };
}
