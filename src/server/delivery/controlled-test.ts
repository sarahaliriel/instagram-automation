import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { getInstagramSettings } from "@/modules/instagram/settings";
import { getDeliverySettings } from "./settings";
import { enqueueDelivery, processDelivery } from "./processor";
import { createMetaMessagingAdapter } from "./meta-messaging";
import { loadApprovedPreparation } from "./approved-preparation";
// Private server entry point for a FUTURE explicitly approved one-comment test.
// No route, cron or script invokes it. This implementation task does not authorize a live send.
export async function runControlledDeliveryTest(
  db: PrismaClient,
  encryptionKey: string,
) {
  const flags = getDeliverySettings();
  if (flags.INSTAGRAM_DELIVERY_MODE !== "controlled_test")
    return { state: "DISABLED" as const };
  const config = getInstagramSettings();
  if (
    !config.META_SYSTEM_USER_ACCESS_TOKEN ||
    !config.META_CLIENT_BUSINESS_ID ||
    !config.META_LOGIN_CONFIG_ID
  )
    throw new Error("Controlled delivery credentials unavailable");
  try {
    await loadApprovedPreparation(db, encryptionKey, flags);
    const action = await enqueueDelivery(
      db,
      flags.INSTAGRAM_DELIVERY_EXECUTION_ID!,
    );
    if (!action) return { state: "DISABLED" as const };
    return await processDelivery(
      db,
      action.id,
      encryptionKey,
      createMetaMessagingAdapter({
        apiVersion: config.INSTAGRAM_API_VERSION,
        executionId: flags.INSTAGRAM_DELIVERY_EXECUTION_ID!,
        approvalId: flags.INSTAGRAM_DELIVERY_APPROVAL_ID!,
        credential: {
          kind: "business_integration_system_user",
          accessToken: config.META_SYSTEM_USER_ACCESS_TOKEN,
          configId: config.META_LOGIN_CONFIG_ID,
          clientBusinessId: config.META_CLIENT_BUSINESS_ID,
        },
      }),
    );
  } catch {
    throw new Error(
      "Controlled delivery requires inspection; never blindly retry",
    );
  }
}
