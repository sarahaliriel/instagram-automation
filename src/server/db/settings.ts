import "server-only";
import { parsePersistenceSettings } from "./settings-schema";
export function getPersistenceSettings() {
  return parsePersistenceSettings({
    DATABASE_URL: process.env.DATABASE_URL,
    EVENT_ENCRYPTION_KEY: process.env.EVENT_ENCRYPTION_KEY,
    JOBS_MODE: process.env.JOBS_MODE,
    INNGEST_DEV: process.env.INNGEST_DEV,
    NODE_ENV: process.env.NODE_ENV,
    INSTAGRAM_INTEGRATION_MODE: process.env.INSTAGRAM_INTEGRATION_MODE,
  });
}
