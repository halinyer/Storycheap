import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildAuthCallbackUrl,
  createSandboxSessionResponse,
  resolveSafeNextPath,
} from "@/lib/server/auth-links";
import { sendAuthVerificationEmail } from "@/lib/server/email";
import {
  getSiteUrl,
  isDemoSandboxEnabled,
  isResendConfigured,
  isSupabaseAdminConfigured,
} from "@/lib/server/env";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseAdmin } from "@/lib/server/supabase-admin";
import { createSupabaseServerClient } from "@/lib/server/supabase-session";

const registerSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  password: z
    .string()
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .max(128, "La contraseña es demasiado larga"),
  next: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit({
    key: `auth:register:${ip}`,
    limit: 10,
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

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase();
  const safeNext = resolveSafeNextPath(parsed.data.next);

  if (isSupabaseAdminConfigured()) {
    const admin = getSupabaseAdmin();
    const redirectTo = `${getSiteUrl()}/api/auth/callback?next=${encodeURIComponent(
      safeNext
    )}`;

    if (admin && isResendConfigured()) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password: parsed.data.password,
        options: { redirectTo },
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("already") || msg.includes("registered")) {
          return NextResponse.json(
            {
              error:
                "Este correo ya tiene una cuenta registrada. Inicia sesión o usa Enlace mágico.",
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      const hashedToken = data.properties?.hashed_token;
      if (!hashedToken) {
        return NextResponse.json(
          { error: "No se pudo generar el enlace de confirmación." },
          { status: 500 }
        );
      }

      const callbackUrl = buildAuthCallbackUrl({
        tokenHash: hashedToken,
        type: "signup",
        next: safeNext,
      });

      const emailRes = await sendAuthVerificationEmail({
        to: email,
        actionUrl: callbackUrl,
        kind: "signup",
      });
      if (!emailRes.sent && !emailRes.sandboxLogged) {
        return NextResponse.json(
          {
            error:
              emailRes.error ??
              "No se pudo enviar el correo de confirmación. Intenta nuevamente.",
          },
          { status: 502 }
        );
      }

      return NextResponse.json({
        mode: "verification_sent",
        message: `Te enviamos un enlace de confirmación a ${email}. Ábrelo para activar tu cuenta y continuar.`,
      });
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Cliente Supabase público no configurado." },
        { status: 500 }
      );
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password: parsed.data.password,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (data.session) {
      return NextResponse.json({
        mode: "signed_in",
        user: { id: data.user?.id, email: data.user?.email },
      });
    }

    return NextResponse.json({
      mode: "verification_sent",
      message: `Te enviamos un enlace de confirmación a ${email}. Ábrelo para activar tu cuenta.`,
    });
  }

  if (!isDemoSandboxEnabled()) {
    return NextResponse.json(
      { error: "Autenticación no configurada en este entorno." },
      { status: 503 }
    );
  }

  return createSandboxSessionResponse({ email });
}
