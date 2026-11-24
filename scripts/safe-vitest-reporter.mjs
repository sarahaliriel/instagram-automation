import { createHash } from "node:crypto";

const marker = "GT_SAFE_VITEST_REPORT:";

export function classifyVitestError(error) {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? "");
  const code = String(error?.code ?? error?.meta?.code ?? "");
  const driverCode = [
    error?.cause?.code,
    error?.meta?.driverAdapterError?.cause?.originalCode,
    error?.meta?.driverAdapterError?.cause?.code,
    error?.meta?.driverAdapterError?.code,
  ].find((value) => typeof value === "string" && /^[0-9A-Z]{5}$/.test(value));
  const prismaCode = /^P\d{4}$/.test(code)
    ? code
    : (message.match(/\bP\d{4}\b/)?.[0] ?? null);
  const postgresCode =
    /^[0-9A-Z]{5}$/.test(String(driverCode ?? code)) &&
    String(driverCode ?? code) !== "ERROR" &&
    !/^P\d{4}$/.test(String(driverCode ?? code))
      ? String(driverCode ?? code)
      : (message.match(/\bSQLSTATE[ =:]+([0-9A-Z]{5})\b/)?.[1] ?? null);
  const callsites = Array.isArray(error?.stacks)
    ? error.stacks.map((item) => String(item?.method ?? "")).join(" ")
    : "";
  const text = `${name} ${message} ${String(error?.stack ?? "")} ${callsites}`;
  let category = "unknown";
  if (/AssertionError|expected .* to |expect\(/i.test(text))
    category = "assertion";
  else if (/timeout|timed out|ETIMEOUT/i.test(text)) category = "timeout";
  else if (
    /Data rights operation denied|authorization|approval|signature/i.test(text)
  )
    category = "authorization";
  else if (prismaCode === "P2039" && postgresCode === null)
    category = "driver_unmapped";
  else if (/beforeEach|beforeAll|fixture|\bseed\b/i.test(text))
    category = "fixture";
  else if (
    /^23[0-9A-Z]{3}$/.test(postgresCode ?? "") ||
    ["P2002", "P2003", "P2004"].includes(prismaCode ?? "") ||
    /constraint|foreign key|duplicate key/i.test(text)
  )
    category = "constraint";
  else if (
    /^08[0-9A-Z]{3}$/.test(postgresCode ?? "") ||
    ["P1000", "P1001", "P1002", "P1003"].includes(prismaCode ?? "") ||
    /ECONNREFUSED|ENOTFOUND|connection|connect ETIMEDOUT/i.test(text)
  )
    category = "connection";
  return { category, prismaCode, postgresCode };
}

export function safeTestId(testCase) {
  return createHash("sha256")
    .update(String(testCase.id))
    .digest("hex")
    .slice(0, 12);
}

export default class SafeVitestReporter {
  passed = 0;
  failed = 0;
  skipped = 0;
  failures = [];

  onUserConsoleLog() {
    return false;
  }

  onTestCaseResult(testCase) {
    const result = testCase.result();
    if (result.state === "passed") this.passed++;
    else if (result.state === "skipped") this.skipped++;
    else if (result.state === "failed") {
      this.failed++;
      const path = String(testCase.module.relativeModuleId);
      const file = /^tests\/integration\/[a-z0-9-]+\.integration\.ts$/.test(
        path,
      )
        ? path
        : null;
      this.failures.push({
        file,
        line: Number.isInteger(testCase.location?.line)
          ? testCase.location.line
          : null,
        testId: safeTestId(testCase),
        ...classifyVitestError(result.errors?.[0]),
      });
    }
  }

  onTestRunEnd(modules, unhandledErrors, reason) {
    const moduleErrors = modules.flatMap((module) => module.errors());
    const startupErrors = [...moduleErrors, ...unhandledErrors];
    const report = {
      event: "vitest_safe_report",
      reason: ["passed", "failed", "interrupted"].includes(reason)
        ? reason
        : "unknown",
      passedTests: this.passed,
      failedTests: this.failed,
      skippedTests: this.skipped,
      collectedModules: modules.length,
      unhandledErrors: startupErrors.length,
      failures: this.failures.slice(0, 30),
      startupCategories: startupErrors.slice(0, 10).map(classifyVitestError),
      truncated: this.failures.length > 30 || startupErrors.length > 10,
    };
    process.stdout.write(`${marker}${JSON.stringify(report)}\n`);
  }
}

export const SAFE_VITEST_REPORT_MARKER = marker;
