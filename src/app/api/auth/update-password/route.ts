import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  isDemoSandboxEnabled,
  isSupabaseAdminConfigured,
} from "@/lib/server/env";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createSupabaseServerClient } from "@/lib/server/supabase-session";

const updatePasswordSchema = z.object({
  password: z
    .string()
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .max(128, "La contraseña es demasiado larga"),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit({
    key: `auth:update-pw:${ip}`,
    limit: 15,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera un minuto." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const parsed = updatePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Contraseña inválida" },
      { status: 400 }
    );
  }

  if (!isSupabaseAdminConfigured()) {
    if (isDemoSandboxEnabled()) {
      return NextResponse.json(
        { error: "El modo Sandbox local no utiliza contraseñas reales." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Base de datos no configurada." },
      { status: 503 }
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Cliente Supabase no configurado." },
      { status: 500 }
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        error:
          "Tu sesión o enlace de recuperación expiró. Solicita un enlace nuevo.",
      },
      { status: 401 }
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("different from the old password")) {
      return NextResponse.json(
        { error: "La nueva contraseña debe ser diferente a la anterior." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    email: user.email,
  });
}
