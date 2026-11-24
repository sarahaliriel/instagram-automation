import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

const dockerDirectory = "/Applications/Docker.app/Contents/Resources/bin";
const account = "development";
export const localServices = {
  password: "instagram-automation.local.postgres-password",
  encryption: "instagram-automation.local.event-encryption-key",
};

function security(args, input) {
  return spawnSync("/usr/bin/security", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function keychainPath() {
  const result = security(["default-keychain", "-d", "user"]);
  const value = result.stdout?.trim().replace(/^"|"$/g, "");
  if (result.status !== 0 || !value || /[\r\n]/.test(value))
    throw new Error("User Keychain is unavailable");
  return value;
}

export function readSecret(service, path) {
  const result = security([
    "find-generic-password",
    "-a",
    account,
    "-s",
    service,
    "-w",
    path,
  ]);
  if (result.status === 44) return undefined;
  if (result.status !== 0)
    throw new Error("Keychain access was denied or is unavailable");
  return result.stdout.trim();
}

function quote(value) {
  return '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

export function initializeKeychain() {
  const path = keychainPath();
  for (const service of Object.values(localServices)) {
    if (readSecret(service, path)) continue;
    const value = randomBytes(32).toString("hex");
    const command = `add-generic-password -a ${account} -s ${service} -w ${value} ${quote(path)}\n`;
    const result = security(["-i"], command);
    if (result.status !== 0 || readSecret(service, path) !== value)
      throw new Error("Keychain secret creation failed");
  }
  console.log(
    "Local development secrets are available in the user Keychain; no existing secret was replaced.",
  );
}

function localPort() {
  const port = Number(process.env.POSTGRES_PORT ?? "5433");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid local PostgreSQL port");
  return port;
}

export function developmentEnvironment() {
  const path =
    !process.env.POSTGRES_PASSWORD || !process.env.EVENT_ENCRYPTION_KEY
      ? keychainPath()
      : undefined;
  const password =
    process.env.POSTGRES_PASSWORD || readSecret(localServices.password, path);
  const encryptionKey =
    process.env.EVENT_ENCRYPTION_KEY ||
    readSecret(localServices.encryption, path);
  if (!password || !/^[a-fA-F0-9]{64}$/.test(encryptionKey ?? ""))
    throw new Error(
      "Inject local secrets or initialize the user Keychain first",
    );
  const port = localPort();
  const base = `postgresql://instagram_app:${encodeURIComponent(password)}@127.0.0.1:${port}/`;
  return {
    ...process.env,
    PATH: existsSync(dockerDirectory)
      ? `${dockerDirectory}:${process.env.PATH ?? ""}`
      : process.env.PATH,
    POSTGRES_PASSWORD: password,
    POSTGRES_PORT: String(port),
    DATABASE_URL: base + "instagram_automation_dev",
    DIRECT_DATABASE_URL: base + "instagram_automation_dev",
    TEST_DATABASE_URL: base + "instagram_automation_test",
    EVENT_ENCRYPTION_KEY: encryptionKey,
    INSTAGRAM_INTEGRATION_MODE: "disabled",
    JOBS_MODE: "disabled",
    INNGEST_DEV: "1",
  };
}

export function rightsEnvironment() {
  const password = readSecret(localServices.password, keychainPath());
  if (!password) throw new Error("Local PostgreSQL credential unavailable");
  const base = `postgresql://instagram_app:${encodeURIComponent(password)}@127.0.0.1:${localPort()}/`;
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    TERM: process.env.TERM,
    DATABASE_URL: base + "instagram_automation_dev",
    DIRECT_DATABASE_URL: base + "instagram_automation_dev",
    TEST_DATABASE_URL: base + "instagram_rights_test",
    JOBS_MODE: "disabled",
    INSTAGRAM_INTEGRATION_MODE: "disabled",
  };
}
