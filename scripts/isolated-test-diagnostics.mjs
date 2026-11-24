export function summarizeChildFailure(phase, result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const code = output.match(/\bP\d{4}\b/)?.[0] ?? null;
  const failed = output.match(/\b(\d+) failed\b/)?.[1];
  const category =
    phase === "vitest_integration"
      ? /ECONNREFUSED|ENOTFOUND|\bP100[0-3]\b|connection refused/i.test(output)
        ? "connection"
        : /timeout|timed out/i.test(output)
          ? "timeout"
          : "vitest_startup_or_collection"
      : "migration";
  return {
    event: "isolated_test_failure",
    phase,
    category,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    prismaCode: code,
    failedTests: failed ? Number(failed) : null,
    rawDiagnosticsWithheld: true,
  };
}

const categories = new Set([
  "assertion",
  "timeout",
  "authorization",
  "fixture",
  "constraint",
  "connection",
  "driver_unmapped",
  "unknown",
]);

export function parseSafeVitestReport(stdout) {
  const prefix = "GT_SAFE_VITEST_REPORT:";
  const line = stdout.split("\n").findLast((item) => item.startsWith(prefix));
  if (!line) return null;
  let value;
  try {
    value = JSON.parse(line.slice(prefix.length));
  } catch {
    return null;
  }
  const count = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000;
  if (
    value?.event !== "vitest_safe_report" ||
    !count(value.passedTests) ||
    !count(value.failedTests) ||
    !count(value.skippedTests) ||
    !count(value.collectedModules) ||
    !count(value.unhandledErrors) ||
    !Array.isArray(value.failures) ||
    !Array.isArray(value.startupCategories)
  )
    return null;
  const safeError = (item) =>
    item &&
    categories.has(item.category) &&
    (item.prismaCode === null || /^P\d{4}$/.test(item.prismaCode)) &&
    (item.postgresCode === null || /^[0-9A-Z]{5}$/.test(item.postgresCode));
  if (
    value.failures.length > 30 ||
    value.startupCategories.length > 10 ||
    value.failures.some(
      (item) =>
        !safeError(item) ||
        (item.file !== null &&
          !/^tests\/integration\/[a-z0-9-]+\.integration\.ts$/.test(
            item.file,
          )) ||
        (item.line !== null && (!count(item.line) || item.line < 1)) ||
        !/^[0-9a-f]{12}$/.test(item.testId),
    ) ||
    value.startupCategories.some((item) => !safeError(item))
  )
    return null;
  return {
    passedTests: value.passedTests,
    failedTests: value.failedTests,
    skippedTests: value.skippedTests,
    collectedModules: value.collectedModules,
    unhandledErrors: value.unhandledErrors,
    failures: value.failures.map((item) => ({
      file: item.file,
      line: item.line,
      testId: item.testId,
      category: item.category,
      prismaCode: item.prismaCode,
      postgresCode: item.postgresCode,
    })),
    startupCategories: value.startupCategories.map((item) => ({
      category: item.category,
      prismaCode: item.prismaCode,
      postgresCode: item.postgresCode,
    })),
    truncated: value.truncated === true,
  };
}
