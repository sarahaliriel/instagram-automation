import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import {
  classifyTestDatabase,
  countPublicExtras,
} from "./rights-test-guard.mjs";
import {
  developmentEnvironment,
  initializeKeychain,
  keychainPath,
  readSecret,
  rightsEnvironment,
} from "./local-development-environment.mjs";
import {
  prismaBinary,
  run,
  runJobs,
  runWebhookObservation,
} from "./local-development-commands.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const action = process.argv[2];
let failurePhase = "startup";
const allowed = [
  "init-keychain",
  "db-up",
  "db-check",
  "db-migrate",
  "db-status",
  "db-diff",
  "test-db-create",
  "rights-test-db-create",
  "rights-test-diagnose",
  "rights-test-marker-adapt",
  "rights-test",
  "test",
  "dev",
  "dashboard",
  "jobs",
  "observe-webhooks",
  "match-webhooks",
];

async function databaseAction(env) {
  const url = new URL(env.DATABASE_URL);
  if (["test-db-create", "rights-test-db-create"].includes(action))
    url.pathname = "/postgres";
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    if (action === "rights-test-db-create") {
      if (!process.stdin.isTTY)
        throw new Error("Interactive approval required");
      const name = "instagram_rights_test";
      const exists = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [name],
      );
      if (exists.rowCount) {
        console.log(
          "Dedicated rights test database already exists; no data was modified.",
        );
        return;
      }
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let answer;
      try {
        answer = await prompt.question(
          `Type 'CREATE ${name}' to create the empty isolated database: `,
        );
      } finally {
        prompt.close();
      }
      if (answer !== `CREATE ${name}`)
        throw new Error("Database creation not approved");
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(
        "Dedicated rights test database created; no migrations or fixtures applied.",
      );
    } else if (action === "test-db-create") {
      const exists = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        ["instagram_automation_test"],
      );
      if (exists.rowCount)
        console.log(
          "Integration test database already exists; no data was modified.",
        );
      else {
        await client.query('CREATE DATABASE "instagram_automation_test"');
        console.log("Separate integration test database created.");
      }
    } else {
      await client.query("SELECT 1");
      console.log("Local PostgreSQL connectivity verified.");
    }
  } finally {
    await client.end();
  }
}
async function diagnoseRightsTestDatabase(env) {
  const adminUrl = new URL(env.DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5000,
  });
  let exists = false;
  try {
    await admin.connect();
    const result = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      ["instagram_rights_test"],
    );
    exists = result.rowCount === 1;
  } finally {
    await admin.end();
  }
  if (!exists) {
    console.log(
      JSON.stringify({ event: "rights_test_diagnosis", databaseExists: false }),
    );
    return;
  }
  const testUrl = new URL(env.TEST_DATABASE_URL);
  testUrl.pathname = "/instagram_rights_test";
  const client = new pg.Client({
    connectionString: testUrl.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const identity = await client.query(
      "SELECT current_database() AS database, current_user AS role, has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects",
    );
    if (identity.rows[0]?.database !== "instagram_rights_test")
      throw new Error("Unexpected test database identity");
    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const names = tables.rows.map((row) => row.tablename);
    const controlTables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'rights_test_control' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    const schemas = (
      await client.query(
        "SELECT nspname FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg_%' ORDER BY nspname",
      )
    ).rows.map((row) => row.nspname);
    const migrations = names.includes("_prisma_migrations")
      ? await client.query(
          'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY started_at',
        )
      : { rows: [] };
    const counts = {};
    for (const name of [
      "InstagramAccount",
      "InstagramComment",
      "WebhookEvent",
      "OutboxMessage",
      "ProcessingExecution",
      "DeliveryAction",
      "MessageAttempt",
      "DataRightsErasure",
    ]) {
      if (names.includes(name)) {
        const result = await client.query(
          `SELECT count(*)::int AS count FROM "${name}"`,
        );
        counts[name] = result.rows[0].count;
      }
    }
    const marker = names.includes("_rights_test_guard")
      ? await client.query(
          'SELECT "databaseName" = $1 AS matches FROM "_rights_test_guard" LIMIT 2',
          ["instagram_rights_test"],
        )
      : { rows: [] };
    const controlMarker = controlTables.includes("exclusive_marker")
      ? await client.query(
          'SELECT "databaseName" = $1 AS matches FROM "rights_test_control"."exclusive_marker" LIMIT 2',
          ["instagram_rights_test"],
        )
      : { rows: [] };
    const legacyMarkerMatches =
      marker.rows.length === 1 && marker.rows[0].matches === true;
    const controlMarkerMatches =
      controlMarker.rows.length === 1 && controlMarker.rows[0].matches === true;
    const publicExtras = await countPublicExtras(client);
    const classification = classifyTestDatabase({
      schemas,
      publicTables: names,
      controlTables,
      legacyMarkerMatches,
      controlMarkerMatches,
      publicExtras,
    });
    console.log(
      JSON.stringify({
        event: "rights_test_diagnosis",
        databaseExists: true,
        accessible: true,
        role: identity.rows[0].role,
        canConnect: identity.rows[0].can_connect,
        canCreateSchemaObjects: identity.rows[0].can_create_schema_objects,
        tables: names,
        controlTables,
        schemas,
        publicExtras,
        markerMatches: legacyMarkerMatches || controlMarkerMatches,
        markerLocation: legacyMarkerMatches
          ? "public"
          : controlMarkerMatches
            ? "rights_test_control"
            : null,
        classification,
        migrations: migrations.rows.map((row) => ({
          name: row.migration_name,
          finished: row.finished,
          rolledBack: row.rolled_back,
        })),
        rowCounts: counts,
      }),
    );
  } finally {
    await client.end();
  }
}
async function adaptRightsTestMarker(env) {
  if (!process.stdin.isTTY) throw new Error("Interactive approval required");
  const client = new pg.Client({
    connectionString: env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const identity = await client.query(
      "SELECT current_database() AS database",
    );
    if (identity.rows[0]?.database !== "instagram_rights_test")
      throw new Error("Wrong database");
    const schemas = (
      await client.query(
        "SELECT nspname FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg_%' ORDER BY nspname",
      )
    ).rows.map((row) => row.nspname);
    const publicTables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    const marker = publicTables.includes("_rights_test_guard")
      ? await client.query(
          'SELECT "databaseName" FROM public."_rights_test_guard" LIMIT 2',
        )
      : { rows: [] };
    const classification = classifyTestDatabase({
      schemas,
      publicTables,
      controlTables: [],
      legacyMarkerMatches:
        marker.rows.length === 1 &&
        marker.rows[0].databaseName === "instagram_rights_test",
      controlMarkerMatches: false,
      publicExtras: await countPublicExtras(client),
    });
    if (classification !== "legacy")
      throw new Error("Legacy marker state not verified; no writes performed");
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    let answer;
    try {
      answer = await prompt.question(
        "Type 'MOVE TEST MARKER instagram_rights_test' to move only the marker out of public: ",
      );
    } finally {
      prompt.close();
    }
    if (answer !== "MOVE TEST MARKER instagram_rights_test")
      throw new Error("Marker move not approved");
    await client.query("BEGIN");
    try {
      await client.query(
        'LOCK TABLE public."_rights_test_guard" IN ACCESS EXCLUSIVE MODE',
      );
      const freshTables = (
        await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
      const controlExists = await client.query(
        "SELECT 1 FROM pg_namespace WHERE nspname = 'rights_test_control'",
      );
      if (
        freshTables.length !== 1 ||
        freshTables[0] !== "_rights_test_guard" ||
        controlExists.rowCount !== 0 ||
        (await countPublicExtras(client)) !== 0
      )
        throw new Error("Test database changed before marker move");
      await client.query('CREATE SCHEMA "rights_test_control"');
      await client.query(
        'ALTER TABLE public."_rights_test_guard" SET SCHEMA "rights_test_control"',
      );
      await client.query(
        'ALTER TABLE "rights_test_control"."_rights_test_guard" RENAME TO "exclusive_marker"',
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error("Marker move failed; transaction rolled back");
    }
    console.log(
      "Exclusive test marker moved to separate schema; no Prisma migration was marked applied.",
    );
  } finally {
    await client.end();
  }
}
async function main() {
  if (!allowed.includes(action) || process.argv.length !== 3) {
    console.log(
      `Usage: node scripts/local-development.mjs <${allowed.join("|")}>`,
    );
    process.exitCode = 1;
    return;
  }
  if (
    ["observe-webhooks", "match-webhooks"].includes(action) &&
    process.env.INSTAGRAM_WEBHOOK_TEST_APPROVAL !== "1"
  )
    throw new Error("Explicit webhook observation approval required");
  if (action === "init-keychain") {
    initializeKeychain();
    return;
  }
  if (action === "jobs") {
    runJobs(root, process.env);
    return;
  }
  if (
    [
      "rights-test",
      "rights-test-db-create",
      "rights-test-diagnose",
      "rights-test-marker-adapt",
    ].includes(action)
  ) {
    failurePhase = "local_postgres_credential";
    const env = rightsEnvironment();
    if (action === "rights-test-diagnose") {
      failurePhase = "read_only_test_database_diagnosis";
      await diagnoseRightsTestDatabase(env);
    } else if (action === "rights-test-marker-adapt") {
      failurePhase = "explicit_test_marker_adaptation";
      await adaptRightsTestMarker(env);
    } else if (action === "rights-test-db-create") {
      failurePhase = "exclusive_test_database_creation";
      await databaseAction(env);
    } else {
      failurePhase = "isolated_test_runner";
      run(root, "npm", ["run", "test:integration"], env);
    }
    return;
  }
  failurePhase = "local_credentials";
  const env = developmentEnvironment();
  if (action === "dashboard") {
    if (
      !process.env.ADMIN_USERNAME ||
      process.env.ADMIN_USERNAME.length > 128 ||
      !process.env.ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWORD.length < 16
    )
      throw new Error("Administrative credentials are required");
    run(root, "npm", ["run", "dev", "--", "--hostname", "127.0.0.1"], {
      ...env,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      INSTAGRAM_ADMIN_READ_MODE: "development",
      INSTAGRAM_INTEGRATION_MODE: "disabled",
      JOBS_MODE: "disabled",
      INNGEST_DEV: "0",
      INSTAGRAM_DELIVERY_MODE: "disabled",
      INSTAGRAM_PUBLIC_FALLBACK_ENABLED: "0",
    });
    return;
  }
  if (["observe-webhooks", "match-webhooks"].includes(action)) {
    runWebhookObservation(root, action, env, readSecret, keychainPath);
    return;
  }
  if (["db-check", "test-db-create"].includes(action)) {
    await databaseAction(env);
    return;
  }
  const prisma = prismaBinary(root);
  if (action === "db-up")
    run(root, "docker", ["compose", "up", "-d", "db"], env);
  if (action === "db-migrate") run(root, prisma, ["migrate", "deploy"], env);
  if (action === "db-status") run(root, prisma, ["migrate", "status"], env);
  if (action === "db-diff")
    run(
      root,
      prisma,
      [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--script",
      ],
      env,
    );
  if (action === "test") run(root, "npm", ["run", "test:integration"], env);
  if (action === "dev")
    run(root, "npm", ["run", "dev", "--", "--hostname", "127.0.0.1"], {
      ...env,
      JOBS_MODE: "development",
    });
}
main().catch(() => {
  // Do not serialize child/driver/Keychain errors, which could contain secrets.
  console.error(
    JSON.stringify({
      event: "local_setup_failure",
      phase: failurePhase,
      message: "no credentials were included",
      rawDiagnosticsWithheld: true,
    }),
  );
  process.exitCode = 1;
});
