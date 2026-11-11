import { connection, NextResponse } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import { isDemoSandboxEnabled, isSupabaseAdminConfigured } from "@/lib/server/env";
import { getUserCreditBalanceCents } from "@/lib/server/repository";

export async function GET() {
  await connection();
  const user = await getServerSessionUser();
  const creditBalanceCents = user
    ? await getUserCreditBalanceCents(user.id)
    : 0;

  return NextResponse.json(
    {
      user,
      creditBalanceCents,
      sandboxEnabled: isDemoSandboxEnabled(),
      supabaseConfigured: isSupabaseAdminConfigured(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
