import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("es-ES", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function maskCode(code: string): string {
  if (!code) return "••••-••••-••••-••••";
  const parts = code.split("-");
  if (parts.length > 2) {
    return `${parts[0]}-••••-••••-${parts[parts.length - 1]}`;
  }
  return code.slice(0, 4) + "••••••••" + code.slice(-4);
}
