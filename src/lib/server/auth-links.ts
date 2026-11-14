import "server-only";
import { NextResponse } from "next/server";
import {
  SANDBOX_AUTH_COOKIE,
  SANDBOX_DEFAULT_ADMIN_ID,
  SANDBOX_DEFAULT_CUSTOMER_ID,
} from "@/lib/server/auth";
import { getSiteUrl } from "@/lib/server/env";
import { ensureCustomerProfile } from "@/lib/server/repository";
import type { SessionUser } from "@/types";

export function resolveSafeNextPath(rawNext?: string | null): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/account";
  }
  return rawNext;
}

export function buildAuthCallbackUrl(params: {
  tokenHash: string;
  type: "signup" | "magiclink";
  next: string;
}): string {
  const qs = new URLSearchParams({
    token_hash: params.tokenHash,
    type: params.type,
    next: params.next,
  });
  return `${getSiteUrl()}/api/auth/callback?${qs.toString()}`;
}

export async function createSandboxSessionResponse(params: {
  email: string;
  sandboxRole?: "customer" | "admin";
}): Promise<NextResponse> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const isAdminDemo =
    params.sandboxRole === "admin" ||
    normalizedEmail === "admin@storycheap.com";

  let userId: string;
  if (isAdminDemo) {
    userId = SANDBOX_DEFAULT_ADMIN_ID;
  } else if (normalizedEmail === "carlos@storycheap.com") {
    userId = SANDBOX_DEFAULT_CUSTOMER_ID;
  } else {
    userId = await ensureCustomerProfile(normalizedEmail);
  }

  const session: SessionUser = {
    id: userId,
    email: isAdminDemo ? "admin@storycheap.com" : normalizedEmail,
    role: isAdminDemo ? "admin" : "customer",
    aal: isAdminDemo ? "aal2" : "aal1",
    isSandbox: true,
  };

  const res = NextResponse.json({
    mode: "sandbox_signed_in",
    user: session,
  });

  res.cookies.set(
    SANDBOX_AUTH_COOKIE,
    encodeURIComponent(JSON.stringify(session)),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    }
  );
  return res;
}
