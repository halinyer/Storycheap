import { connection, NextResponse } from "next/server";
import { getPagoMovilAvailabilitySnapshot } from "@/lib/server/payments/pagomovil-bdv";

export async function GET() {
  await connection();
  try {
    const snapshot = await getPagoMovilAvailabilitySnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[api/payments/pagomovil/availability] Error:", err);
    return NextResponse.json(
      {
        enabled: false,
        configured: false,
        bdvApiConfigured: false,
        available: false,
        bsRateCents: null,
        receiverBankName: null,
        receiverAccountType: null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
