import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getPersistenceSettings } from "./settings";

export function createDatabaseClient(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString,
        max: 5,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
      },
      {
        onPoolError: () =>
          console.error(JSON.stringify({ event: "database_pool_error" })),
        onConnectionError: () =>
          console.error(JSON.stringify({ event: "database_connection_error" })),
      },
    ),
    errorFormat: "minimal",
    log: [],
  });
}
const globalDatabase = globalThis as unknown as { database?: PrismaClient };
export function getDatabase() {
  const settings = getPersistenceSettings();
  if (!settings.DATABASE_URL) throw new Error("DATABASE_URL is required");
  globalDatabase.database ??= createDatabaseClient(settings.DATABASE_URL);
  return globalDatabase.database;
}
