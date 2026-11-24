import { expect, it } from "vitest";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { requireIsolatedTestDatabaseUrl } from "./support/database";

it("backfills legacy Phase 4 execution identity without changing its decision or UUID", async () => {
  const url = requireIsolatedTestDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  const schema = "phase5a_migration_" + randomUUID().replaceAll("-", "");
  const account = randomUUID(),
    media = randomUUID(),
    comment = randomUUID(),
    event = randomUUID(),
    execution = randomUUID();
  const migration = (name: string) =>
    readFile(
      new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
      "utf8",
    );
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(await migration("202611170001_durable_inbox"));
    await client.query(await migration("202611170002_canonical_comment_fk"));
    await client.query(
      `INSERT INTO "InstagramAccount" (id, "providerId") VALUES ($1, '10001')`,
      [account],
    );
    await client.query(
      `INSERT INTO "InstagramMedia" (id, "accountId", "providerId") VALUES ($1, $2, '10002')`,
      [media, account],
    );
    await client.query(
      `INSERT INTO "InstagramComment" (id, "accountId", "mediaId", "providerId") VALUES ($1, $2, $3, '10003')`,
      [comment, account, media],
    );
    await client.query(
      `INSERT INTO "WebhookEvent" (id, "accountId", "commentId", "providerCommentId", "notificationTime", state, "updatedAt") VALUES ($1, $2, $3, '10003', 1, 'PROCESSED', now())`,
      [event, account, comment],
    );
    await client.query(
      `INSERT INTO "ProcessingExecution" (id, "eventId", state, "reasonCode") VALUES ($1, $2, 'SKIPPED', 'AUTOMATION_NOT_IMPLEMENTED')`,
      [execution, event],
    );
    // Enum addition commits separately, exactly as Prisma Migrate applies the files.
    await client.query(await migration("202611170003_ready_state"));
    await client.query(await migration("202611170004_automation_matching"));
    await client.query(await migration("202611190005_delivery_ledger"));
    await client.query(
      await migration("202611190006_delivery_transition_guards"),
    );
    const result = await client.query(
      `SELECT id, "eventId", "accountId", "commentId", state, "reasonCode", "engineVersion", "intentCiphertext" FROM "ProcessingExecution" WHERE id = $1`,
      [execution],
    );
    expect(result.rows[0]).toEqual({
      id: execution,
      eventId: event,
      accountId: account,
      commentId: comment,
      state: "SKIPPED",
      reasonCode: "AUTOMATION_NOT_IMPLEMENTED",
      engineVersion: "legacy-phase4",
      intentCiphertext: null,
    });
    expect(
      (
        await client.query(`SELECT state FROM "WebhookEvent" WHERE id = $1`, [
          event,
        ])
      ).rows[0].state,
    ).toBe("PROCESSED");
    await client.query(await migration("202611190007_data_rights_erasure"));
    await client.query(await migration("202611200001_manual_get_provenance"));
    await client.query(await migration("202611200002_automation_drafts"));
    const rule = randomUUID(),
      delivery = randomUUID();
    await client.query(
      `INSERT INTO "AutomationRule" (id, "accountId", name, enabled, strategy, scope, "privateMessageTemplateCiphertext", "updatedAt") VALUES ($1, $2, 'Synthetic historical rule', true, 'EXACT', 'GLOBAL', 'synthetic-ciphertext', now())`,
      [rule, account],
    );
    await client.query(
      `INSERT INTO "DeliveryAction" (id, "executionId", kind, state, mode, "operationIdCiphertext", "updatedAt") VALUES ($1, $2, 'PRIVATE_REPLY', 'ACCEPTED_BY_META', 'MOCK', 'synthetic-operation', now())`,
      [delivery, execution],
    );
    const before = await client.query(
      `SELECT to_jsonb(r) AS rule, (SELECT to_jsonb(c) FROM "InstagramComment" c WHERE c.id = $2) AS comment, (SELECT to_jsonb(x) FROM "ProcessingExecution" x WHERE x.id = $3) AS execution, (SELECT to_jsonb(d) FROM "DeliveryAction" d WHERE d.id = $4) AS delivery FROM "AutomationRule" r WHERE r.id = $1`,
      [rule, comment, execution, delivery],
    );
    await client.query(await migration("202611220001_temporal_eligibility"));
    const after = await client.query(
      `SELECT to_jsonb(r) - 'activatedAt' AS rule, r."activatedAt", (SELECT to_jsonb(c) - 'providerCreatedAt' FROM "InstagramComment" c WHERE c.id = $2) AS comment, (SELECT c."providerCreatedAt" FROM "InstagramComment" c WHERE c.id = $2) AS "providerCreatedAt", (SELECT to_jsonb(x) FROM "ProcessingExecution" x WHERE x.id = $3) AS execution, (SELECT to_jsonb(d) FROM "DeliveryAction" d WHERE d.id = $4) AS delivery FROM "AutomationRule" r WHERE r.id = $1`,
      [rule, comment, execution, delivery],
    );
    expect(after.rows[0]).toEqual({
      ...before.rows[0],
      activatedAt: null,
      providerCreatedAt: null,
    });
  } finally {
    // Only the fresh schema and synthetic records created by this test are removed.
    await client.query(`SET search_path TO public`);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
