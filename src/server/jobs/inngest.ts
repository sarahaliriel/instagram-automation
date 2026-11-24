import "server-only";
import { Inngest } from "inngest";

const safeLogger = {
  debug() {},
  info() {},
  warn() {
    console.warn(JSON.stringify({ event: "job_provider_warning" }));
  },
  error() {
    console.error(JSON.stringify({ event: "job_provider_error" }));
  },
};
// Development is deliberately local-only. No Cloud credentials or external payloads.
export const inngest = new Inngest({
  id: "instagram-automation-manager",
  isDev: true,
  baseUrl: "http://127.0.0.1:8288",
  logger: safeLogger,
  internalLogger: safeLogger,
  fetch: (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
});
