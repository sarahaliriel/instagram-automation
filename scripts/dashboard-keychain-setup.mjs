import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertLoginDefault,
  buildCreateArgs,
} from "./meta-keychain-command.mjs";
import { dashboardAdminServices } from "./dashboard-local-environment.mjs";

const security = "/usr/bin/security";
const account = "development";
const loginKeychain = join(homedir(), "Library/Keychains/login.keychain-db");

function present(service) {
  const result = spawnSync(
    security,
    ["find-generic-password", "-a", account, "-s", service, loginKeychain],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status === 0) return true;
  if (result.status === 44) return false;
  throw new Error("Could not inspect the login Keychain");
}

function main() {
  if (
    process.platform !== "darwin" ||
    process.env.NODE_ENV === "production" ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.argv.length !== 2 ||
    !existsSync(loginKeychain)
  )
    throw new Error("Run interactively on macOS with the login Keychain");
  const defaultResult = spawnSync(
    security,
    ["default-keychain", "-d", "user"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (defaultResult.status !== 0)
    throw new Error("Cannot verify the user default Keychain");
  assertLoginDefault(defaultResult.stdout, loginKeychain);
  for (const [name, service] of Object.entries(dashboardAdminServices)) {
    if (present(service)) {
      console.log(`${name}: PRESENT`);
      continue;
    }
    console.log(`${name}: enter your value in the native hidden prompt`);
    const created = spawnSync(security, buildCreateArgs(service), {
      stdio: "inherit",
    });
    if (created.status !== 0 || !present(service))
      throw new Error("Keychain item creation failed");
    console.log(`${name}: PRESENT`);
  }
  console.log("Dashboard credentials are present; no value was displayed.");
}

try {
  main();
} catch {
  console.error(
    "Dashboard Keychain setup stopped. No existing item was overwritten and no value was displayed.",
  );
  process.exitCode = 1;
}
