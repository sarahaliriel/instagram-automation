export const dashboardAdminServices = Object.freeze({
  ADMIN_USERNAME: "instagram-automation.local.admin-username",
  ADMIN_PASSWORD: "instagram-automation.local.admin-password",
});

export function dashboardEnvironment(base, readDashboardSecret) {
  const username =
    base.ADMIN_USERNAME ??
    readDashboardSecret(dashboardAdminServices.ADMIN_USERNAME);
  const password =
    base.ADMIN_PASSWORD ??
    readDashboardSecret(dashboardAdminServices.ADMIN_PASSWORD);
  if (
    !username ||
    username.length > 128 ||
    username.includes(":") ||
    /[\r\n]/.test(username)
  )
    throw new Error("Local dashboard username is unavailable or invalid");
  if (!password || password.length < 16 || /[\r\n]/.test(password))
    throw new Error("Local dashboard password is unavailable or invalid");
  return {
    ...base,
    APP_URL: "http://localhost:3000",
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD: password,
    INSTAGRAM_INTEGRATION_MODE: "disabled",
    JOBS_MODE: "disabled",
    INNGEST_DEV: "0",
    INSTAGRAM_DELIVERY_MODE: "disabled",
    INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "0",
  };
}
