import { NextResponse, type NextRequest } from "next/server";
import {
  isAuthorizedAdmin,
  parseAdminCredentials,
} from "@/modules/auth/admin-auth";

export async function proxy(request: NextRequest) {
  const configured = parseAdminCredentials(process.env);
  const authorized = await isAuthorizedAdmin(
    request.headers.get("authorization"),
    configured,
  );
  if (authorized) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return new NextResponse(
    configured
      ? "Autenticação administrativa necessária."
      : "Dashboard administrativo não configurado.",
    {
      status: configured ? 401 : 503,
      headers: {
        ...(configured
          ? {
              "WWW-Authenticate": 'Basic realm="GT Dashboard", charset="UTF-8"',
            }
          : {}),
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

export const config = { matcher: ["/dashboard/:path*"] };
