import "server-only";
import type { OrderStatus } from "@/types";

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: [
    "PENDING_PAYMENT",
    "PAID",
    "CANCELLED",
    "EXPIRED",
    "REFUNDED_CREDIT",
  ],
  PENDING_PAYMENT: [
    "PAID",
    "EXPIRED",
    "CANCELLED",
    "REFUNDED_CREDIT",
    "MANUAL_REVIEW",
  ],
  PAID: ["FULFILLING", "DELIVERED", "PARTIAL", "MANUAL_REVIEW", "REFUNDED_CREDIT"],
  FULFILLING: ["DELIVERED", "PARTIAL", "MANUAL_REVIEW", "REFUNDED_CREDIT"],
  PARTIAL: ["FULFILLING", "DELIVERED", "MANUAL_REVIEW", "REFUNDED_CREDIT"],
  MANUAL_REVIEW: ["FULFILLING", "DELIVERED", "REFUNDED_CREDIT", "CANCELLED"],
  DELIVERED: [],
  EXPIRED: ["REFUNDED_CREDIT", "MANUAL_REVIEW"],
  CANCELLED: [],
  REFUNDED_CREDIT: [],
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; description: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  CREATED: {
    label: "Orden creada",
    description: "Preparando tu enlace de pago seguro.",
    tone: "neutral",
  },
  PENDING_PAYMENT: {
    label: "Esperando pago",
    description: "Completa el pago en la pasarela cripto dentro del tiempo límite.",
    tone: "info",
  },
  PAID: {
    label: "Pago confirmado",
    description: "Tu pago fue verificado correctamente. Preparando tus códigos.",
    tone: "info",
  },
  FULFILLING: {
    label: "Preparando tu código",
    description: "Estamos asignando y verificando tus códigos digitales.",
    tone: "info",
  },
  DELIVERED: {
    label: "Listo para canjear",
    description: "Todos tus códigos están listos en tu bóveda segura.",
    tone: "success",
  },
  PARTIAL: {
    label: "Entrega parcial",
    description:
      "Ya tienes códigos listos; nuestro equipo está completando el resto o acreditará tu saldo a favor.",
    tone: "warning",
  },
  MANUAL_REVIEW: {
    label: "En revisión",
    description:
      "Tu pago fue recibido y nuestro equipo está verificando la entrega manualmente. No tienes que volver a pagar.",
    tone: "warning",
  },
  EXPIRED: {
    label: "Pago expirado",
    description: "El tiempo de pago venció antes de recibir confirmación.",
    tone: "neutral",
  },
  CANCELLED: {
    label: "Cancelada",
    description: "Esta orden fue cancelada antes de completarse.",
    tone: "neutral",
  },
  REFUNDED_CREDIT: {
    label: "Saldo acreditado",
    description: "El monto correspondiente fue acreditado a tu saldo a favor interno.",
    tone: "success",
  },
};
