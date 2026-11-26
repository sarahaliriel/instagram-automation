import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasSensitiveEnvironment } from "./build.mjs";

test("allows only the exact Vercel OIDC platform variable", () => {
  assert.equal(hasSensitiveEnvironment({ VERCEL_OIDC_TOKEN: "dummy" }), false);
  for (const name of [
    "vercel_oidc_token",
    "VERCEL_OIDC_TOKEN_EXTRA",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
  ])
    assert.equal(hasSensitiveEnvironment({ [name]: "dummy" }), true);
});

test("rejects sensitive application configuration even alongside OIDC", () => {
  for (const name of [
    "META_ACCESS_TOKEN",
    "DATABASE_URL",
    "POSTGRES_URL",
    "INNGEST_EVENT_KEY",
    "INSTAGRAM_ID",
    "EVENT_ENCRYPTION_KEY",
    "PASSWORD",
    "API_KEY",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "APP_SECRET",
  ])
    assert.equal(
      hasSensitiveEnvironment({ VERCEL_OIDC_TOKEN: "dummy", [name]: "dummy" }),
      true,
    );
});

test("failure diagnostic reports only rejected names, never values", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./build.mjs", import.meta.url))],
    {
      env: {
        META_ACCESS_TOKEN: "value-must-not-appear",
        DATABASE_URL: "another-private-value",
        VERCEL_OIDC_TOKEN: "oidc-private-value",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /rejected names: \["DATABASE_URL","META_ACCESS_TOKEN"\]/,
  );
  for (const value of [
    "value-must-not-appear",
    "another-private-value",
    "oidc-private-value",
    "VERCEL_OIDC_TOKEN",
  ])
    assert.doesNotMatch(result.stderr + result.stdout, new RegExp(value));
});
