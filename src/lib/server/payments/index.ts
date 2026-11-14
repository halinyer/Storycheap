import "server-only";
import type { PaymentGatewayId } from "@/types";
import { PagoMovilBotAdapter } from "./pagomovil-bot";
import type { PaymentGatewayAdapter } from "./types";
import { ZenoBankAdapter } from "./zenobank";

let zenoBankAdapter: ZenoBankAdapter | null = null;
let pagoMovilBotAdapter: PagoMovilBotAdapter | null = null;

export function getPaymentGateway(id: PaymentGatewayId): PaymentGatewayAdapter {
  switch (id) {
    case "zenobank":
      zenoBankAdapter ??= new ZenoBankAdapter();
      return zenoBankAdapter;
    case "pagomovil":
    case "pablito":
      pagoMovilBotAdapter ??= new PagoMovilBotAdapter();
      return pagoMovilBotAdapter;
  }
}
