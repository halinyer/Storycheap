import "server-only";
import type { PaymentGatewayId } from "@/types";
import { PagoMovilBdvAdapter } from "./pagomovil-bdv";
import type { PaymentGatewayAdapter } from "./types";
import { ZenoBankAdapter } from "./zenobank";

let zenoBankAdapter: ZenoBankAdapter | null = null;
let pagoMovilBdvAdapter: PagoMovilBdvAdapter | null = null;

export function getPaymentGateway(id: PaymentGatewayId): PaymentGatewayAdapter {
  switch (id) {
    case "zenobank":
      zenoBankAdapter ??= new ZenoBankAdapter();
      return zenoBankAdapter;
    case "pagomovil":
    case "pablito":
      pagoMovilBdvAdapter ??= new PagoMovilBdvAdapter();
      return pagoMovilBdvAdapter;
  }
}
