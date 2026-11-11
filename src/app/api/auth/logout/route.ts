import { NextResponse } from "next/server";
import { SANDBOX_AUTH_COOKIE } from "@/lib/server/auth";
import { isSupabaseAdminConfigured } from "@/lib/server/env";
import { createSupabaseServerClient } from "@/lib/server/supabase-session";

export async function POST() {
  if (isSupabaseAdminConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase?.auth.signOut();
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SANDBOX_AUTH_COOKIE);
  return res;
}
