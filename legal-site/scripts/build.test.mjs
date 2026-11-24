import assert from "node:assert/strict";
import { test } from "node:test";
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
