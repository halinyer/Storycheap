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

const loginSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  sandboxRole: z.enum(["customer", "admin"]).optional(),
  next: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit({
    key: `auth:magic:${ip}`,
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

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Correo inválido" },
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
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      const hashedToken = data.properties?.hashed_token;
      if (!hashedToken) {
        return NextResponse.json(
          { error: "No se pudo generar el enlace de acceso." },
          { status: 500 }
        );
      }

      const callbackUrl = buildAuthCallbackUrl({
        tokenHash: hashedToken,
        type: "magiclink",
        next: safeNext,
      });

      const emailRes = await sendAuthVerificationEmail({
        to: email,
        actionUrl: callbackUrl,
        kind: "magiclink",
      });
      if (!emailRes.sent && !emailRes.sandboxLogged) {
        return NextResponse.json(
          {
            error:
              emailRes.error ??
              "No se pudo enviar el enlace de acceso. Intenta nuevamente.",
          },
          { status: 502 }
        );
      }

      return NextResponse.json({
        mode: "magic_link_sent",
        message: `Te enviamos un enlace mágico de acceso a ${email}.`,
      });
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Cliente Supabase público no configurado." },
        { status: 500 }
      );
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({
      mode: "magic_link_sent",
      message: `Te enviamos un enlace mágico de acceso a ${email}.`,
    });
  }

  if (!isDemoSandboxEnabled()) {
    return NextResponse.json(
      { error: "Autenticación no configurada en este entorno." },
      { status: 503 }
    );
  }

  return createSandboxSessionResponse({
    email,
    sandboxRole: parsed.data.sandboxRole,
  });
}
