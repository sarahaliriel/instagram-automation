import { defineConfig } from "prisma/config";

// CLI values are injected explicitly; never read or overwrite developer secret files.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
