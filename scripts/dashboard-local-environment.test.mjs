import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardAdminServices,
  dashboardEnvironment,
} from "./dashboard-local-environment.mjs";

test("creates a read-only local dashboard environment from private values", () => {
  const values = {
    [dashboardAdminServices.ADMIN_USERNAME]: "private-admin",
    [dashboardAdminServices.ADMIN_PASSWORD]: "a-private-password",
  };
  const result = dashboardEnvironment(
    {
      JOBS_MODE: "development",
      INNGEST_DEV: "1",
      INSTAGRAM_DELIVERY_MODE: "controlled_test",
      INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "1",
    },
    (service) => values[service],
  );
  assert.equal(result.APP_URL, "http://localhost:3000");
  assert.equal(result.INSTAGRAM_INTEGRATION_MODE, "disabled");
  assert.equal(result.JOBS_MODE, "disabled");
  assert.equal(result.INNGEST_DEV, "0");
  assert.equal(result.INSTAGRAM_DELIVERY_MODE, "disabled");
  assert.equal(result.INSTAGRAM_PUBLIC_FALLBACK_ENABLED, "0");
});

test("fails closed for missing, weak or ambiguous credentials", () => {
  for (const values of [
    {},
    {
      [dashboardAdminServices.ADMIN_USERNAME]: "admin:name",
      [dashboardAdminServices.ADMIN_PASSWORD]: "a-private-password",
    },
    {
      [dashboardAdminServices.ADMIN_USERNAME]: "admin",
      [dashboardAdminServices.ADMIN_PASSWORD]: "short",
    },
  ])
    assert.throws(() => dashboardEnvironment({}, (service) => values[service]));
});
