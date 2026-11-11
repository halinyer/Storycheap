import "server-only";
import { cookies } from "next/headers";
import type { SessionUser } from "@/types";
import { isDemoSandboxEnabled, isSupabaseAdminConfigured } from "./env";
import { createSupabaseServerClient } from "./supabase-session";

export const SANDBOX_AUTH_COOKIE = "storycheap_sandbox_session";
export const SANDBOX_DEFAULT_CUSTOMER_ID = "00000000-0000-4000-8000-00000000c001";
export const SANDBOX_DEFAULT_ADMIN_ID = "00000000-0000-4000-8000-00000000a001";

function parseSandboxCookie(raw: string | undefined): SessionUser | null {
  if (!raw || !isDemoSandboxEnabled()) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<SessionUser>;
    if (!parsed.id || !parsed.email) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      role: parsed.role === "admin" ? "admin" : "customer",
      aal: parsed.aal === "aal2" ? "aal2" : "aal1",
      isSandbox: true,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the active user via Supabase Auth (when configured) or non-production demo sandbox cookie.
 * Never returns an unverified or forged role in production Supabase mode.
 */
export async function getServerSessionUser(): Promise<SessionUser | null> {
  if (isSupabaseAdminConfigured()) {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user || !user.email) return null;

    const appRole = user.app_metadata?.role === "admin" ? "admin" : "customer";
    let aal: "aal1" | "aal2" = "aal1";
    try {
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.currentLevel === "aal2") {
        aal = "aal2";
      }
    } catch {
      aal = "aal1";
    }

    return {
      id: user.id,
      email: user.email,
      role: appRole,
      aal,
      isSandbox: false,
    };
  }

  if (!isDemoSandboxEnabled()) return null;
  try {
    const store = await cookies();
    const cookieVal = store.get(SANDBOX_AUTH_COOKIE)?.value;
    return parseSandboxCookie(cookieVal);
  } catch {
    return null;
  }
}

export async function requireAuthenticatedUser(): Promise<SessionUser> {
  const user = await getServerSessionUser();
  if (!user) {
    throw new AuthError("UNAUTHENTICATED", "Debes iniciar sesión para continuar.", 401);
  }
  return user;
}

export async function requireAdminUser(): Promise<SessionUser> {
  const user = await requireAuthenticatedUser();
  if (user.role !== "admin") {
    throw new AuthError(
      "FORBIDDEN",
      "No tienes permisos de administrador.",
      403
    );
  }
  // Enforce MFA AAL2 in real Supabase production admin operations
  if (!user.isSandbox && user.aal !== "aal2") {
    throw new AuthError(
      "MFA_REQUIRED",
      "Se requiere autenticación multifactor (AAL2) para operar la consola administrativa.",
      403
    );
  }
  return user;
}

export class AuthError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "MFA_REQUIRED",
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}
