import { NextResponse, type NextRequest } from "next/server";
import { SANDBOX_AUTH_COOKIE } from "@/lib/server/auth";
import { isDemoSandboxEnabled, isSupabaseAdminConfigured } from "@/lib/server/env";

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
}

/**
 * Next.js 16 Proxy (`src/proxy.ts`) performing optimistic route protection only.
 * Authoritative authentication, role (`app_metadata.role`), and MFA (`aal2`)
 * checks are always re-verified in Server Components, Server Actions, and Route Handlers.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/account")) {
    const hasSession = isSupabaseAdminConfigured()
      ? hasSupabaseAuthCookie(request)
      : isDemoSandboxEnabled() &&
        Boolean(request.cookies.get(SANDBOX_AUTH_COOKIE)?.value);

    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/account/:path*"],
};
