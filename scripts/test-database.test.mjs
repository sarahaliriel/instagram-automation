import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("integration runner rejects development and non-loopback targets before connecting", () => {
  for (const target of [
    "postgresql://user:synthetic@127.0.0.1:5433/instagram_automation_dev",
    "postgresql://user:synthetic@127.0.0.1:5433/another_test",
    "postgresql://user:synthetic@remote.example/instagram_rights_test",
  ]) {
    const result = spawnSync(process.execPath, ["scripts/test-database.mjs"], {
      env: { ...process.env, TEST_DATABASE_URL: target, DATABASE_URL: "" },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic@/);
  }
});

test("integration runner rejects overlap with the application database", () => {
  const result = spawnSync(process.execPath, ["scripts/test-database.mjs"], {
    env: {
      ...process.env,
      TEST_DATABASE_URL:
        "postgresql://test:synthetic@127.0.0.1:5433/instagram_rights_test",
      DATABASE_URL:
        "postgresql://app:synthetic@localhost:5433/instagram_rights_test",
      DIRECT_DATABASE_URL: "",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /overlaps an application database/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic@/);
});
