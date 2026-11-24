import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditArtifact } from "./audit.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legal-audit-"));
  for (const route of ["", "privacy", "terms", "data-deletion"]) {
    const directory = join(root, route);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), "<html lang=pt-PT></html>");
  }
  return root;
}
test("accepts only four routes and static assets", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, "_next/static/css"), { recursive: true });
    await writeFile(
      join(root, "_next/static/css/style.css"),
      "body{color:black}",
    );
    assert.equal((await auditArtifact(root)).length, 5);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("rejects private files, source maps and backend references", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, ".env.local"), "x");
    await assert.rejects(auditArtifact(root));
    await rm(join(root, ".env.local"));
    await mkdir(join(root, "_next/static/css"), { recursive: true });
    await writeFile(join(root, "_next/static/css/app.js.map"), "{}");
    await assert.rejects(auditArtifact(root));
    await rm(join(root, "_next/static/css/app.js.map"));
    await writeFile(join(root, "index.html"), "/api/inngest");
    await assert.rejects(auditArtifact(root));
  } finally {
    await rm(root, { recursive: true });
  }
});
