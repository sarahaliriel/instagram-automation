import { defineConfig } from "vitest/config";
// @ts-expect-error Vite loads the explicit .mts config; tsc disallows TS extension imports here.
import base from "./vitest.config.mts";
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/integration/**/*.integration.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    includeTaskLocation: true,
  },
});
