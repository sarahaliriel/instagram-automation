export async function register() {
  const { getEnvironment } = await import("@/shared/config/env");
  getEnvironment();
  const { getInstagramSettings } = await import("@/modules/instagram/settings");
  getInstagramSettings();
  const { getPersistenceSettings } = await import("@/server/db/settings");
  getPersistenceSettings();
  const { getDeliverySettings } = await import("@/server/delivery/settings");
  getDeliverySettings();
}
