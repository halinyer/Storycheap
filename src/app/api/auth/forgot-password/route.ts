import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildAuthCallbackUrl } from "@/lib/server/auth-links";
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

const forgotSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
});

const NEUTRAL_RECOVERY_MESSAGE =
  "Si el correo está registrado en StoryCheap, te enviamos un enlace para restablecer tu contraseña.";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit({
    key: `auth:forgot:${ip}`,
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

  const parsed = forgotSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Correo inválido" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase();

  if (isSupabaseAdminConfigured()) {
    const admin = getSupabaseAdmin();
    const redirectTo = `${getSiteUrl()}/api/auth/callback?next=${encodeURIComponent(
      "/reset-password"
    )}`;

    if (admin && isResendConfigured()) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes("not found") ||
          msg.includes("no user") ||
          msg.includes("user not found") ||
          error.status === 404
        ) {
          return NextResponse.json({
            mode: "recovery_sent",
            message: NEUTRAL_RECOVERY_MESSAGE,
          });
        }
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      const hashedToken = data.properties?.hashed_token;
      if (!hashedToken) {
        return NextResponse.json(
          { error: "No se pudo generar el enlace de recuperación." },
          { status: 500 }
        );
      }

      const callbackUrl = buildAuthCallbackUrl({
        tokenHash: hashedToken,
        type: "recovery",
        next: "/reset-password",
      });

      const emailRes = await sendAuthVerificationEmail({
        to: email,
        actionUrl: callbackUrl,
        kind: "recovery",
      });

      if (!emailRes.sent && !emailRes.sandboxLogged) {
        return NextResponse.json(
          {
            error:
              emailRes.error ??
              "No se pudo enviar el correo de recuperación. Intenta nuevamente.",
          },
          { status: 502 }
        );
      }

      return NextResponse.json({
        mode: "recovery_sent",
        message: NEUTRAL_RECOVERY_MESSAGE,
      });
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Cliente Supabase público no configurado." },
        { status: 500 }
      );
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error && error.status === 429) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    return NextResponse.json({
      mode: "recovery_sent",
      message: NEUTRAL_RECOVERY_MESSAGE,
    });
  }

  if (isDemoSandboxEnabled()) {
    return NextResponse.json(
      {
        error:
          "El modo Sandbox local no usa contraseñas; usa los botones rápidos de acceso en /login.",
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { error: "Autenticación no configurada en este entorno." },
    { status: 503 }
  );
}
