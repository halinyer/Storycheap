import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseAdminConfigured } from "@/lib/server/env";
import { createSupabaseServerClient } from "@/lib/server/supabase-session";

const loginSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
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
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    );
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Base de datos no configurada." },
      { status: 500 }
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Cliente Supabase no configurado." },
      { status: 500 }
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message === "Invalid login credentials" ? "Credenciales incorrectas" : error.message },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: data.user.id,
      email: data.user.email,
    },
  });
}
