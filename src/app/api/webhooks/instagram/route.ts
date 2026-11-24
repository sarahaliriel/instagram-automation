import { getDatabase } from "@/server/db/client";
import { getPersistenceSettings } from "@/server/db/settings";
import { persistComments } from "@/server/db/ingest-comments";
import { getInstagramSettings } from "@/modules/instagram/settings";
import {
  receiveWebhook,
  verifyWebhook,
} from "@/modules/webhooks/instagram-handler";
import { errorResponse } from "@/shared/http/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuration() {
  const settings = getInstagramSettings();
  if (
    settings.INSTAGRAM_INTEGRATION_MODE !== "development" ||
    process.env.NODE_ENV === "production"
  )
    return null;
  return {
    appSecret: settings.META_WEBHOOK_APP_SECRET!,
    verifyToken: settings.INSTAGRAM_WEBHOOK_VERIFY_TOKEN!,
    accountId: settings.INSTAGRAM_ACCOUNT_ID!,
  };
}
function disabled() {
  return Response.json(
    { status: "integration_disabled" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
export function GET(request: Request) {
  try {
    const config = configuration();
    return config ? verifyWebhook(request, config) : disabled();
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const config = configuration();
    return config
      ? await receiveWebhook(request, config, async (events) => {
          const settings = getPersistenceSettings();
          if (!settings.EVENT_ENCRYPTION_KEY)
            throw new Error("Event encryption key required");
          await persistComments(
            getDatabase(),
            events,
            settings.EVENT_ENCRYPTION_KEY,
          );
        })
      : disabled();
  } catch (error) {
    return errorResponse(error);
  }
}
