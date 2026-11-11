import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  SANDBOX_AUTH_COOKIE,
  SANDBOX_DEFAULT_ADMIN_ID,
  SANDBOX_DEFAULT_CUSTOMER_ID,
} from "@/lib/server/auth";
import {
  getSiteUrl,
  isDemoSandboxEnabled,
  isSupabaseAdminConfigured,
} from "@/lib/server/env";
import { ensureCustomerProfile } from "@/lib/server/repository";
import { createSupabaseServerClient } from "@/lib/server/supabase-session";
import type { SessionUser } from "@/types";

const loginSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  sandboxRole: z.enum(["customer", "admin"]).optional(),
});

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Correo inválido" },
      { status: 400 }
    );
  }

  if (isSupabaseAdminConfigured()) {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Cliente Supabase público no configurado." },
        { status: 500 }
      );
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email.toLowerCase(),
      options: {
        emailRedirectTo: `${getSiteUrl()}/api/auth/callback`,
      },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({
      mode: "magic_link_sent",
      message: "Te enviamos un enlace mágico de acceso a tu correo.",
    });
  }

  if (!isDemoSandboxEnabled()) {
    return NextResponse.json(
      { error: "Autenticación no configurada en este entorno." },
      { status: 503 }
    );
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const isAdminDemo =
    parsed.data.sandboxRole === "admin" ||
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
