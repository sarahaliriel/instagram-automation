import { getEnvironment } from "@/shared/config/env";
import { errorResponse } from "@/shared/http/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness only: this does not check database, jobs, authentication, or Meta.
export function GET() {
  try {
    getEnvironment();
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
