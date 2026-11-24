import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import {
  parseSafeVitestReport,
  summarizeChildFailure,
} from "./isolated-test-diagnostics.mjs";
import {
  classifyTestDatabase,
  countPublicExtras,
} from "./rights-test-guard.mjs";

// Never load .env.local, fall back to DATABASE_URL, or reset an arbitrary database.
const value = process.env.TEST_DATABASE_URL;
let url;
try {
  url = new URL(value);
} catch {
  throw new Error(
    "Set TEST_DATABASE_URL to an isolated local PostgreSQL test database",
  );
}
if (
  !["postgresql:", "postgres:"].includes(url.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/instagram_rights_test"
) {
  throw new Error(
    "Integration tests require the dedicated local instagram_rights_test database",
  );
}
// Refuse a test target that is also configured as the ordinary application DB.
for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL"]) {
  const other = process.env[name];
  if (!other) continue;
  try {
    const candidate = new URL(other);
    const loopback = (host) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(host);
    if (
      (candidate.hostname === url.hostname ||
        (loopback(candidate.hostname) && loopback(url.hostname))) &&
      (candidate.port || "5432") === (url.port || "5432") &&
      candidate.pathname === url.pathname
    )
      throw new Error("Test database overlaps an application database");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Test database overlaps an application database"
    )
      throw error;
    throw new Error(`Invalid ${name}; refusing destructive integration tests`);
  }
}
const env = { ...process.env, DATABASE_URL: value, DIRECT_DATABASE_URL: value };
// A database suffix alone is not proof that existing contents are disposable.
// A fresh target must have no application tables. Subsequent runs require the
// marker installed after an interactive, exact-name confirmation.
const client = new pg.Client({
  connectionString: value,
  connectionTimeoutMillis: 3000,
});
let classification;
try {
  await client.connect();
  const identity = await client.query("SELECT current_database() AS database");
  if (identity.rows[0]?.database !== url.pathname.slice(1)) throw new Error();
  const schemas = (
    await client.query(
      "SELECT nspname FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg_%' ORDER BY nspname",
    )
  ).rows.map((row) => row.nspname);
  const tables = (
    await client.query(
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'rights_test_control') ORDER BY schemaname, tablename",
    )
  ).rows;
  const publicTables = tables
    .filter((row) => row.schemaname === "public")
    .map((row) => row.tablename);
  const controlTables = tables
    .filter((row) => row.schemaname === "rights_test_control")
    .map((row) => row.tablename);
  const markerMatches = async (table) => {
    const result = await client.query(
      `SELECT "databaseName" FROM ${table} LIMIT 2`,
    );
    return (
      result.rows.length === 1 &&
      result.rows[0].databaseName === url.pathname.slice(1)
    );
  };
  classification = classifyTestDatabase({
    schemas,
    publicTables,
    controlTables,
    legacyMarkerMatches: publicTables.includes("_rights_test_guard")
      ? await markerMatches('public."_rights_test_guard"')
      : false,
    controlMarkerMatches: controlTables.includes("exclusive_marker")
      ? await markerMatches('rights_test_control."exclusive_marker"')
      : false,
    publicExtras: await countPublicExtras(client),
  });
} catch {
  throw new Error(
    "Test database identity or exclusivity could not be verified; no writes performed",
  );
}
if (classification === "legacy") {
  await client.end();
  throw new Error(
    "Legacy marker in public requires explicit adaptation before migrations; no writes performed",
  );
}
if (classification !== "fresh" && classification !== "ready") {
  await client.end();
  throw new Error(
    "Unknown test database objects or invalid marker; no writes performed",
  );
}
if (!process.stdin.isTTY) {
  await client.end();
  throw new Error(
    "Interactive confirmation is required before test database writes",
  );
}
const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const expected = `AUTHORIZE TEST ONLY ${url.pathname.slice(1)}`;
let answer;
try {
  answer = await prompt.question(
    `Type '${expected}' to allow migrations and fixture cleanup: `,
  );
} finally {
  prompt.close();
}
if (answer !== expected) {
  await client.end();
  throw new Error("Test database change not approved");
}
if (classification === "fresh") {
  try {
    await client.query("BEGIN");
    await client.query('CREATE SCHEMA "rights_test_control"');
    await client.query(
      'CREATE TABLE "rights_test_control"."exclusive_marker" ("databaseName" text PRIMARY KEY)',
    );
    await client.query(
      'INSERT INTO "rights_test_control"."exclusive_marker" ("databaseName") VALUES ($1)',
      [url.pathname.slice(1)],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
    throw new Error(
      "Could not mark exclusive test database; migrations not started",
    );
  }
}
await client.end();
for (const args of [
  ["prisma", "migrate", "deploy"],
  [
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.mts",
    "--reporter=./scripts/safe-vitest-reporter.mjs",
  ],
]) {
  const result = spawnSync("npx", args, {
    env,
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
  });
  const isMigration = args[1] === "migrate";
  const safeReport = isMigration
    ? null
    : parseSafeVitestReport(result.stdout ?? "");
  if (result.status !== 0) {
    const phase = isMigration ? "prisma_migrate_deploy" : "vitest_integration";
    console.error(
      JSON.stringify({
        ...summarizeChildFailure(phase, result),
        ...(safeReport
          ? {
              category:
                safeReport.failures[0]?.category ??
                safeReport.startupCategories[0]?.category ??
                "vitest_startup_or_collection",
              passedTests: safeReport.passedTests,
              failedTests: safeReport.failedTests,
              skippedTests: safeReport.skippedTests,
              failures: safeReport.failures,
              startupCategories: safeReport.startupCategories,
              unhandledErrors: safeReport.unhandledErrors,
              truncated: safeReport.truncated,
            }
          : {}),
      }),
    );
    process.exit(result.status ?? 1);
  }
  if (isMigration) console.log("Isolated test migrations applied.");
  else {
    if (
      !safeReport ||
      safeReport.failedTests > 0 ||
      safeReport.unhandledErrors > 0
    ) {
      console.error(
        JSON.stringify({
          event: "isolated_test_failure",
          phase: "vitest_integration",
          category: "missing_safe_report",
          exitCode: result.status,
          rawDiagnosticsWithheld: true,
        }),
      );
      process.exit(1);
    }
    console.log(
      JSON.stringify({
        event: "isolated_test_success",
        phase: "vitest_integration",
        passedTests: safeReport.passedTests,
        failedTests: safeReport.failedTests,
      }),
    );
  }
}
