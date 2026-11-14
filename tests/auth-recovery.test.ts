import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuthCallbackUrl } from "@/lib/server/auth-links";

const mockEnv = vi.hoisted(() => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  isResendConfigured: vi.fn(() => true),
  isDemoSandboxEnabled: vi.fn(() => false),
  getSiteUrl: vi.fn(() => "https://storycheap.com"),
}));

const mockGenerateLink = vi.hoisted(() => vi.fn());
const mockResetPasswordForEmail = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() => vi.fn());
const mockUpdateUser = vi.hoisted(() => vi.fn());
const mockVerifyOtp = vi.hoisted(() => vi.fn());
const mockExchangeCodeForSession = vi.hoisted(() => vi.fn());
const mockSendAuthEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/env", () => ({
  isSupabaseAdminConfigured: mockEnv.isSupabaseAdminConfigured,
  isResendConfigured: mockEnv.isResendConfigured,
  isDemoSandboxEnabled: mockEnv.isDemoSandboxEnabled,
  getSiteUrl: mockEnv.getSiteUrl,
}));

vi.mock("@/lib/server/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: {
      admin: {
        generateLink: mockGenerateLink,
      },
    },
  })),
}));

vi.mock("@/lib/server/supabase-session", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      resetPasswordForEmail: mockResetPasswordForEmail,
      getUser: mockGetUser,
      updateUser: mockUpdateUser,
      verifyOtp: mockVerifyOtp,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  })),
}));

vi.mock("@/lib/server/email", () => ({
  sendAuthVerificationEmail: mockSendAuthEmail,
}));

import { GET as callbackGet } from "@/app/api/auth/callback/route";
import { POST as forgotPost } from "@/app/api/auth/forgot-password/route";
import { POST as updatePasswordPost } from "@/app/api/auth/update-password/route";

describe("auth password recovery & reset flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.isSupabaseAdminConfigured.mockReturnValue(true);
    mockEnv.isResendConfigured.mockReturnValue(true);
    mockEnv.isDemoSandboxEnabled.mockReturnValue(false);
    mockEnv.getSiteUrl.mockReturnValue("https://storycheap.com");
    mockSendAuthEmail.mockResolvedValue({ sent: true, sandboxLogged: false });
  });

  it("builds callback URL cleanly for recovery tokens", () => {
    const url = buildAuthCallbackUrl({
      tokenHash: "tok_123",
      type: "recovery",
      next: "/reset-password",
    });
    expect(url).toBe(
      "https://storycheap.com/api/auth/callback?token_hash=tok_123&type=recovery&next=%2Freset-password"
    );
  });

  it("forgot-password rejects malformed emails", async () => {
    const req = new NextRequest("https://storycheap.com/api/auth/forgot-password", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    const res = await forgotPost(req);
    expect(res.status).toBe(400);
  });

  it("forgot-password sends recovery email via Resend when user exists", async () => {
    mockGenerateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: "hash_recovery_abc" } },
      error: null,
    });

    const req = new NextRequest("https://storycheap.com/api/auth/forgot-password", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.2" },
      body: JSON.stringify({ email: "Admin@StoryCheap.com" }),
    });
    const res = await forgotPost(req);
    const json = (await res.json()) as { mode?: string; message?: string };

    expect(res.status).toBe(200);
    expect(json.mode).toBe("recovery_sent");
    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "admin@storycheap.com",
      options: {
        redirectTo:
          "https://storycheap.com/api/auth/callback?next=%2Freset-password",
      },
    });
    expect(mockSendAuthEmail).toHaveBeenCalledWith({
      to: "admin@storycheap.com",
      kind: "recovery",
      actionUrl:
        "https://storycheap.com/api/auth/callback?token_hash=hash_recovery_abc&type=recovery&next=%2Freset-password",
    });
  });

  it("forgot-password returns neutral 200 even when user does not exist", async () => {
    mockGenerateLink.mockResolvedValueOnce({
      data: null,
      error: { message: "User not found", status: 404 },
    });

    const req = new NextRequest("https://storycheap.com/api/auth/forgot-password", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.3" },
      body: JSON.stringify({ email: "ghost@example.com" }),
    });
    const res = await forgotPost(req);
    expect(res.status).toBe(200);
    expect(mockSendAuthEmail).not.toHaveBeenCalled();
  });

  it("update-password requires minimum 6 chars and active session", async () => {
    const shortReq = new NextRequest(
      "https://storycheap.com/api/auth/update-password",
      {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.4" },
        body: JSON.stringify({ password: "123" }),
      }
    );
    const shortRes = await updatePasswordPost(shortReq);
    expect(shortRes.status).toBe(400);

    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const unauthReq = new NextRequest(
      "https://storycheap.com/api/auth/update-password",
      {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.5" },
        body: JSON.stringify({ password: "NewStrongPassword123!" }),
      }
    );
    const unauthRes = await updatePasswordPost(unauthReq);
    expect(unauthRes.status).toBe(401);
  });

  it("update-password updates password when session exists and maps same-password error", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "admin@storycheap.com" } },
      error: null,
    });
    mockUpdateUser.mockResolvedValueOnce({ error: null });

    const okReq = new NextRequest(
      "https://storycheap.com/api/auth/update-password",
      {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.6" },
        body: JSON.stringify({ password: "NewStrongPassword123!" }),
      }
    );
    const okRes = await updatePasswordPost(okReq);
    expect(okRes.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: "NewStrongPassword123!",
    });

    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "admin@storycheap.com" } },
      error: null,
    });
    mockUpdateUser.mockResolvedValueOnce({
      error: { message: "New password should be different from the old password" },
    });
    const dupReq = new NextRequest(
      "https://storycheap.com/api/auth/update-password",
      {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.7" },
        body: JSON.stringify({ password: "SameOldPassword123!" }),
      }
    );
    const dupRes = await updatePasswordPost(dupReq);
    expect(dupRes.status).toBe(400);
    const dupJson = (await dupRes.json()) as { error?: string };
    expect(dupJson.error).toContain("diferente");
  });

  it("auth callback defaults recovery links to /reset-password and handles expired recovery OTP", async () => {
    mockVerifyOtp.mockResolvedValueOnce({ error: null });
    const okReq = new NextRequest(
      "https://storycheap.com/api/auth/callback?token_hash=tok_ok&type=recovery"
    );
    const okRes = await callbackGet(okReq);
    expect(okRes.status).toBe(307);
    expect(okRes.headers.get("location")).toBe(
      "https://storycheap.com/reset-password"
    );

    mockVerifyOtp.mockResolvedValueOnce({
      error: { message: "Token has expired" },
    });
    const expReq = new NextRequest(
      "https://storycheap.com/api/auth/callback?token_hash=tok_bad&type=recovery"
    );
    const expRes = await callbackGet(expReq);
    expect(expRes.status).toBe(307);
    expect(expRes.headers.get("location")).toBe(
      "https://storycheap.com/reset-password?error=expired"
    );
  });
});
