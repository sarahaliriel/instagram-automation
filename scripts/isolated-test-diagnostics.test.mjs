import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSafeVitestReport,
  summarizeChildFailure,
} from "./isolated-test-diagnostics.mjs";
import SafeVitestReporter, {
  classifyVitestError,
  safeTestId,
} from "./safe-vitest-reporter.mjs";

test("diagnostics identify phase and code without exposing child output", () => {
  const summary = summarizeChildFailure("prisma_migrate_deploy", {
    status: 1,
    signal: null,
    stdout: "postgresql://user:private@127.0.0.1/db",
    stderr: "Error P3018 password=private",
  });
  assert.equal(summary.phase, "prisma_migrate_deploy");
  assert.equal(summary.prismaCode, "P3018");
  assert.doesNotMatch(JSON.stringify(summary), /private|postgresql:\/\//);
});

test("diagnostics count failed tests without names or payloads", () => {
  const summary = summarizeChildFailure("vitest_integration", {
    status: 1,
    stdout: "Tests 2 failed | payload=private",
    stderr: "",
  });
  assert.equal(summary.failedTests, 2);
  assert.doesNotMatch(JSON.stringify(summary), /payload|private/);
});

test("structured reporter preserves only safe identifiers and codes", () => {
  const report = {
    event: "vitest_safe_report",
    passedTests: 4,
    failedTests: 1,
    skippedTests: 0,
    collectedModules: 1,
    unhandledErrors: 0,
    failures: [
      {
        file: "tests/integration/data-rights.integration.ts",
        line: 42,
        testId: safeTestId({ id: "private-fixture-id" }),
        category: "constraint",
        prismaCode: "P2004",
        postgresCode: "23514",
        privatePayload: "private",
      },
    ],
    startupCategories: [],
    truncated: false,
  };
  const parsed = parseSafeVitestReport(
    `GT_SAFE_VITEST_REPORT:${JSON.stringify(report)}\n`,
  );
  assert.equal(parsed.failedTests, 1);
  assert.equal(parsed.failures[0].line, 42);
  assert.doesNotMatch(JSON.stringify(parsed), /private|Payload/);
});

test("malformed reporter output fails closed", () => {
  assert.equal(parseSafeVitestReport("startup failed"), null);
  assert.equal(
    parseSafeVitestReport('GT_SAFE_VITEST_REPORT:{"failedTests":"secret"}'),
    null,
  );
});

test("error categories distinguish connection, constraint, assertion and timeout", () => {
  assert.deepEqual(
    classifyVitestError({
      code: "P2039",
      message: "constraint details withheld",
      meta: { driverAdapterError: { cause: { originalCode: "23514" } } },
    }),
    { category: "constraint", prismaCode: "P2039", postgresCode: "23514" },
  );
  assert.equal(
    classifyVitestError({ code: "P2039", message: "constraint unknown" })
      .category,
    "driver_unmapped",
  );
  assert.equal(
    classifyVitestError({ code: "23514", message: "private" }).category,
    "constraint",
  );
  assert.equal(
    classifyVitestError({ code: "P1001", message: "private" }).category,
    "connection",
  );
  assert.equal(
    classifyVitestError({ code: "P2004", message: "private" }).postgresCode,
    null,
  );
  assert.equal(
    classifyVitestError({ name: "AssertionError", message: "private" })
      .category,
    "assertion",
  );
  assert.equal(
    classifyVitestError({ message: "Test timed out private" }).category,
    "timeout",
  );
  assert.equal(
    classifyVitestError({ message: "Data rights operation denied private" })
      .category,
    "authorization",
  );
  assert.equal(
    classifyVitestError({ message: "beforeEach fixture private" }).category,
    "fixture",
  );
});

test("reporter emits a sanitized failed case without raw error text", () => {
  const reporter = new SafeVitestReporter();
  reporter.onTestCaseResult({
    id: "synthetic-case",
    module: {
      relativeModuleId: "tests/integration/data-rights.integration.ts",
    },
    location: { line: 17 },
    result: () => ({
      state: "failed",
      errors: [{ code: "23514", message: "private payload" }],
    }),
  });
  const previous = process.stdout.write;
  let output = "";
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    reporter.onTestRunEnd([], [], "failed");
  } finally {
    process.stdout.write = previous;
  }
  const parsed = parseSafeVitestReport(output);
  assert.equal(parsed.failedTests, 1);
  assert.equal(parsed.failures[0].category, "constraint");
  assert.doesNotMatch(output, /private payload|synthetic-case/);
});
