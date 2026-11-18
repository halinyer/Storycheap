import { NextResponse } from "next/server";
import { updateBotDeviceHeartbeat } from "@/lib/server/pagomovil-store";
import {
  PagoMovilAuthError,
  parseBotPayloadRaw,
  sanitizeBotBatteryLevel,
  verifyBotDeviceAuthentication,
} from "@/lib/server/payments/pagomovil-bot";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function extractFallbackHeartbeatTelemetry(
  rawBody: string,
  searchParams?: URLSearchParams
): {
  batteryLevel: number | null;
  networkType: string | null;
  appVersion: string | null;
} {
  const batteryMatch = rawBody.match(
    /battery_?level["']?\s*[:=]\s*["']?(\d{1,3})/i
  );
  const networkMatch = rawBody.match(
    /network_?type["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{2,32})/i
  );
  const versionMatch = rawBody.match(
    /app_?version["']?\s*[:=]\s*["']?([A-Za-z0-9._-]{1,32})/i
  );

  return {
    batteryLevel: sanitizeBotBatteryLevel(
      batteryMatch?.[1] ?? searchParams?.get("battery_level") ?? null
    ),
    networkType:
      networkMatch?.[1] ?? searchParams?.get("network_type") ?? null,
    appVersion: versionMatch?.[1] ?? searchParams?.get("app_version") ?? null,
  };
}

async function handleHeartbeat(request: Request, rawBody: string) {
  const headers = Object.fromEntries(request.headers.entries());

  try {
    const auth = await verifyBotDeviceAuthentication({ rawBody, headers });
    const searchParams = new URL(request.url).searchParams;

    let batteryLevel: number | null = sanitizeBotBatteryLevel(
      searchParams.get("battery_level")
    );
    let networkType: string | null = searchParams.get("network_type");
    let appVersion: string | null = searchParams.get("app_version");
    let warning: string | undefined;

    if (rawBody.trim()) {
      try {
        const meta = parseBotPayloadRaw(
          rawBody,
          request.headers.get("content-type")
        );
        batteryLevel =
          sanitizeBotBatteryLevel(meta.battery_level) ?? batteryLevel;
        networkType =
          typeof meta.network_type === "string"
            ? meta.network_type
            : networkType;
        appVersion =
          typeof meta.app_version === "string" ? meta.app_version : appVersion;
      } catch {
        const fallback = extractFallbackHeartbeatTelemetry(
          rawBody,
          searchParams
        );
        batteryLevel = fallback.batteryLevel ?? batteryLevel;
        networkType = fallback.networkType ?? networkType;
        appVersion = fallback.appVersion ?? appVersion;
        warning =
          "Telemetría opcional del heartbeat no tenía JSON válido; latido registrado igualmente.";
      }
    }

    await updateBotDeviceHeartbeat(auth.deviceId, {
      batteryLevel,
      networkType,
      appVersion,
    });

    return NextResponse.json(
      {
        ok: true,
        deviceId: auth.deviceId,
        deviceName: auth.deviceName,
        serverTime: new Date().toISOString(),
        ...(warning ? { warning } : {}),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    if (err instanceof PagoMovilAuthError) {
      console.warn("[api/bot/heartbeat] Auth rejected:", {
        method: request.method,
        deviceId: headers["x-bot-device-id"] ?? null,
        status: err.status,
        reason: err.message,
      });
      return NextResponse.json(
        { error: err.message },
        { status: err.status, headers: NO_STORE_HEADERS }
      );
    }
    console.error("[api/bot/heartbeat] Error:", err);
    return NextResponse.json(
      { error: "Error interno procesando heartbeat." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  return handleHeartbeat(request, rawBody);
}

export async function GET(request: Request) {
  return handleHeartbeat(request, "");
}
