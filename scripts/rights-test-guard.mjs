export const CONTROL_SCHEMA = "rights_test_control";
export const CONTROL_TABLE = "exclusive_marker";
export const LEGACY_TABLE = "_rights_test_guard";

export async function countPublicExtras(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*) FROM pg_views WHERE schemaname = 'public') +
      (SELECT count(*) FROM pg_matviews WHERE schemaname = 'public') +
      (SELECT count(*) FROM pg_sequences WHERE schemaname = 'public') +
      (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typtype = 'e') +
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public') AS count
  `);
  return Number(result.rows[0]?.count ?? 0);
}

const allowedPublicTables = new Set([
  "_prisma_migrations",
  "InstagramAccount",
  "InstagramMedia",
  "InstagramComment",
  "WebhookEvent",
  "OutboxMessage",
  "AutomationRule",
  "AutomationKeyword",
  "ProcessingExecution",
  "EventTransition",
  "DeliveryAction",
  "MessageAttempt",
  "DataRightsErasure",
]);

export function classifyTestDatabase({
  schemas,
  publicTables,
  controlTables,
  legacyMarkerMatches,
  controlMarkerMatches,
  publicExtras = 0,
}) {
  if (schemas.some((name) => !["public", CONTROL_SCHEMA].includes(name)))
    return "reject";
  if (
    publicTables.length === 1 &&
    publicTables[0] === LEGACY_TABLE &&
    !schemas.includes(CONTROL_SCHEMA) &&
    legacyMarkerMatches &&
    publicExtras === 0
  )
    return "legacy";
  if (publicTables.includes(LEGACY_TABLE)) return "reject";
  if (!schemas.includes(CONTROL_SCHEMA))
    return publicTables.length === 0 && publicExtras === 0 ? "fresh" : "reject";
  if (
    controlTables.length !== 1 ||
    controlTables[0] !== CONTROL_TABLE ||
    !controlMarkerMatches ||
    publicTables.some((name) => !allowedPublicTables.has(name))
  )
    return "reject";
  return "ready";
}
