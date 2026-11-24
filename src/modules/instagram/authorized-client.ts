import "server-only";
import { createInstagramClient, MetaApiError } from "./client";
import { getInstagramSettings } from "./settings";

// Official App Dashboard token integration; no public route exposes this factory.
export function getAuthorizedInstagramClient() {
  const settings = getInstagramSettings();
  if (
    settings.INSTAGRAM_INTEGRATION_MODE !== "development" ||
    !settings.META_SYSTEM_USER_ACCESS_TOKEN ||
    !settings.META_LOGIN_CONFIG_ID ||
    !settings.META_CLIENT_BUSINESS_ID ||
    !settings.INSTAGRAM_ACCOUNT_ID
  ) {
    throw new MetaApiError(
      "configuration",
      undefined,
      undefined,
      undefined,
      "not_requested",
    );
  }
  return createInstagramClient({
    apiVersion: settings.INSTAGRAM_API_VERSION,
    accountId: settings.INSTAGRAM_ACCOUNT_ID,
    credential: {
      kind: "business_integration_system_user",
      accessToken: settings.META_SYSTEM_USER_ACCESS_TOKEN,
      configId: settings.META_LOGIN_CONFIG_ID,
      clientBusinessId: settings.META_CLIENT_BUSINESS_ID,
    },
  });
}

// Narrow dashboard capability: fixed-host authenticated GET operations only.
// It deliberately omits subscription, comment and messaging-adjacent methods.
export function getAuthorizedInstagramReadClient() {
  const settings = getInstagramSettings();
  if (
    (settings.INSTAGRAM_ADMIN_READ_MODE !== "development" &&
      settings.INSTAGRAM_INTEGRATION_MODE !== "development") ||
    !settings.META_SYSTEM_USER_ACCESS_TOKEN ||
    !settings.META_LOGIN_CONFIG_ID ||
    !settings.META_CLIENT_BUSINESS_ID ||
    !settings.INSTAGRAM_ACCOUNT_ID
  ) {
    throw new MetaApiError(
      "configuration",
      undefined,
      undefined,
      undefined,
      "not_requested",
    );
  }
  const client = createInstagramClient({
    apiVersion: settings.INSTAGRAM_API_VERSION,
    accountId: settings.INSTAGRAM_ACCOUNT_ID,
    credential: {
      kind: "business_integration_system_user",
      accessToken: settings.META_SYSTEM_USER_ACCESS_TOKEN,
      configId: settings.META_LOGIN_CONFIG_ID,
      clientBusinessId: settings.META_CLIENT_BUSINESS_ID,
    },
  });
  return Object.freeze({
    getAccount: client.getAccount,
    listDashboardMedia: client.listDashboardMedia,
  });
}
