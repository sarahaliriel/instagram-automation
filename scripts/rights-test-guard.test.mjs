import assert from "node:assert/strict";
import test from "node:test";
import { classifyTestDatabase } from "./rights-test-guard.mjs";

const base = {
  schemas: ["public"],
  publicTables: [],
  controlTables: [],
  legacyMarkerMatches: false,
  controlMarkerMatches: false,
};

test("fresh database has no Prisma-managed objects", () => {
  assert.equal(classifyTestDatabase(base), "fresh");
});

test("legacy public marker is isolated for explicit adaptation", () => {
  assert.equal(
    classifyTestDatabase({
      ...base,
      publicTables: ["_rights_test_guard"],
      legacyMarkerMatches: true,
    }),
    "legacy",
  );
});

test("separate control schema permits an empty public schema", () => {
  assert.equal(
    classifyTestDatabase({
      ...base,
      schemas: ["public", "rights_test_control"],
      controlTables: ["exclusive_marker"],
      controlMarkerMatches: true,
    }),
    "ready",
  );
});

test("unknown objects or invalid markers fail closed", () => {
  for (const changed of [
    { publicTables: ["some_useful_table"] },
    { publicExtras: 1 },
    { schemas: ["public", "other_schema"] },
    {
      schemas: ["public", "rights_test_control"],
      controlTables: ["exclusive_marker"],
    },
    {
      publicTables: ["_rights_test_guard", "some_useful_table"],
      legacyMarkerMatches: true,
    },
  ])
    assert.equal(classifyTestDatabase({ ...base, ...changed }), "reject");
});
