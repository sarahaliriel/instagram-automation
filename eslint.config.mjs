import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "src/generated/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "legal-site/.next/**",
    "legal-site/node_modules/**",
    "legal-site/static-out/**",
    "legal-site/src/app/(legal)/**",
    "legal-site/src/app/layout.tsx",
    "legal-site/src/app/globals.css",
    "legal-site/next-env.d.ts",
  ]),
]);

export default eslintConfig;
