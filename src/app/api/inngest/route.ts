import type { NextRequest } from "next/server";
import { serve } from "inngest/next";
import { inngest } from "@/server/jobs/inngest";
import {
  dispatchComments,
  processComments,
  simulateDeliveries,
} from "@/server/jobs/functions";
import { getPersistenceSettings } from "@/server/db/settings";
import { errorResponse } from "@/shared/http/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = serve({
  client: inngest,
  functions: [dispatchComments, processComments, simulateDeliveries],
});

async function handle(request: NextRequest, context: unknown) {
  try {
    const settings = getPersistenceSettings();
    // Local dev SDK intentionally bypasses signatures. This route is never enabled
    // in production and must never be included in a public tunnel ingress rule.
    const host = new URL(request.url).hostname;
    if (
      settings.JOBS_MODE !== "development" ||
      process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(host)
    ) {
      return Response.json(
        { status: "jobs_disabled" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (request.method === "GET") return handlers.GET(request, context);
    if (request.method === "PUT") return handlers.PUT(request, context);
    return handlers.POST(request, context);
  } catch (error) {
    return errorResponse(error);
  }
}
export { handle as GET, handle as POST, handle as PUT };
