import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function run(root, command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(
      "Local development command failed; credentials were not printed by the launcher",
    );
}

export function runJobs(root, env) {
  const sdkUrl = new URL(
    process.env.INNGEST_SDK_URL ?? "http://127.0.0.1:3000/api/inngest",
  );
  if (
    sdkUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(sdkUrl.hostname) ||
    sdkUrl.pathname !== "/api/inngest" ||
    sdkUrl.search ||
    sdkUrl.hash ||
    sdkUrl.username ||
    sdkUrl.password
  )
    throw new Error("Inngest SDK URL must be the local callback");
  const safe = { ...env, INNGEST_DEV: "1" };
  for (const name of [
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "TEST_DATABASE_URL",
    "EVENT_ENCRYPTION_KEY",
    "INSTAGRAM_ACCESS_TOKEN",
    "META_SYSTEM_USER_ACCESS_TOKEN",
    "META_WEBHOOK_APP_SECRET",
    "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
  ])
    delete safe[name];
  for (const name of Object.keys(safe))
    if (
      name.startsWith("INSTAGRAM_DELIVERY_") ||
      name === "META_LOGIN_CONFIG_ID" ||
      name === "META_CLIENT_BUSINESS_ID"
    )
      delete safe[name];
  run(
    root,
    "npx",
    [
      "--yes",
      "inngest-cli@1.53.0",
      "dev",
      "--host",
      "127.0.0.1",
      "--no-discovery",
      "--log-level",
      "warn",
      "--sdk-url",
      sdkUrl.href,
    ],
    safe,
  );
}

export function runWebhookObservation(
  root,
  action,
  env,
  readSecret,
  keychainPath,
) {
  const path = keychainPath();
  const webhook = {
    META_WEBHOOK_APP_SECRET:
      "instagram-automation.local.meta-webhook-app-secret",
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN:
      "instagram-automation.local.instagram-webhook-verify-token",
    INSTAGRAM_ACCOUNT_ID: "instagram-automation.local.instagram-account-id",
  };
  for (const [name, service] of Object.entries(webhook)) {
    env[name] = process.env[name] || readSecret(service, path);
    if (!env[name])
      throw new Error("Webhook observation configuration missing");
  }
  delete env.META_SYSTEM_USER_ACCESS_TOKEN;
  delete env.INSTAGRAM_ACCESS_TOKEN;
  for (const name of Object.keys(env))
    if (name.startsWith("INSTAGRAM_DELIVERY_")) delete env[name];
  run(
    root,
    "npm",
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3145"],
    {
      ...env,
      INSTAGRAM_INTEGRATION_MODE: "development",
      JOBS_MODE: action === "observe-webhooks" ? "disabled" : "development",
      INSTAGRAM_DELIVERY_MODE: "disabled",
      INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "0",
    },
  );
}

export function prismaBinary(root) {
  return join(root, "node_modules", ".bin", "prisma");
}
