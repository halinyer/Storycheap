import { NextResponse } from "next/server";
import { updateBotDeviceHeartbeat } from "@/lib/server/pagomovil-store";
import {
  PagoMovilAuthError,
  verifyBotDeviceAuthentication,
} from "@/lib/server/payments/pagomovil-bot";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const headers = Object.fromEntries(request.headers.entries());

    const auth = await verifyBotDeviceAuthentication({ rawBody, headers });

    let meta: {
      battery_level?: number;
      network_type?: string;
      app_version?: string;
    } = {};

    if (rawBody.trim()) {
      try {
        meta = JSON.parse(rawBody) as typeof meta;
      } catch {
        return NextResponse.json(
          { error: "Payload JSON inválido en heartbeat." },
          { status: 400 }
        );
      }
    }

    await updateBotDeviceHeartbeat(auth.deviceId, {
      batteryLevel:
        typeof meta.battery_level === "number" ? meta.battery_level : null,
      networkType:
        typeof meta.network_type === "string" ? meta.network_type : null,
      appVersion:
        typeof meta.app_version === "string" ? meta.app_version : null,
    });

    return NextResponse.json({
      ok: true,
      deviceId: auth.deviceId,
      deviceName: auth.deviceName,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof PagoMovilAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/bot/heartbeat] Error:", err);
    return NextResponse.json(
      { error: "Error interno procesando heartbeat." },
      { status: 500 }
    );
  }
}
