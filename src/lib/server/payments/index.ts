import "server-only";
import type { PaymentGatewayId } from "@/types";
import type { PaymentGatewayAdapter } from "./types";
import { ZenoBankAdapter } from "./zenobank";

const zenoBankAdapter = new ZenoBankAdapter();

export function getPaymentGateway(id: PaymentGatewayId): PaymentGatewayAdapter {
  switch (id) {
    case "zenobank":
      return zenoBankAdapter;
    case "pablito":
      throw new Error(
        "La pasarela Pablito Pago Móvil aún no está habilitada. Por favor usa ZenoBank."
      );
  }
}
