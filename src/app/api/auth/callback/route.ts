import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/server/supabase-session";

const VALID_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
  "email",
]);

function resolveSafeNext(rawNext: string | null): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/account";
  }
  return rawNext;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const safeNext = resolveSafeNext(searchParams.get("next"));

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${safeNext}`);
      }
    }

    if (tokenHash && rawType && VALID_OTP_TYPES.has(rawType as EmailOtpType)) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: rawType as EmailOtpType,
      });
      if (!error) {
        return NextResponse.redirect(`${origin}${safeNext}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
