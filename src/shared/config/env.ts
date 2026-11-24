import "server-only";
import { parseEnvironment } from "@/shared/config/env-schema";

export function getEnvironment() {
  return parseEnvironment({
    NODE_ENV: process.env.NODE_ENV,
    APP_URL: process.env.APP_URL,
  });
}
