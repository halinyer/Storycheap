export interface ParsedBankNotification {
  matched: boolean;
  isIncomingPayment: boolean;
  directionReason?: string;
  bankHint: string | null;
  amountBsCents: number | null;
  currency: "VES" | "USD" | "USDT";
  referenceFull: string | null;
  referenceLast6: string | null;
  referenceLast4: string | null;
  senderPhone: string | null;
  senderDni: string | null;
  senderBankCode: string | null;
  confidence: "high" | "medium" | "low";
  parserUsed: string;
  failureReason: string | null;
}

export interface ParseNotificationInput {
  title?: string | null;
  content: string;
  appPackage?: string | null;
  sourceType?: "APP_PUSH" | "SMS" | "EMAIL" | "MANUAL";
  preferredBankCode?: string | null;
}
