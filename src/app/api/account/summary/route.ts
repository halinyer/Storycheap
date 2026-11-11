import { connection, NextResponse } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import {
  getUserCreditBalanceCents,
  listCreditLedgerForUser,
  listOrdersForUser,
} from "@/lib/server/repository";

export async function GET() {
  await connection();
  const user = await getServerSessionUser();
  if (!user) {
    return NextResponse.json(
      { user: null, creditBalanceCents: 0, orders: [], ledger: [] },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const [creditBalanceCents, orders, ledger] = await Promise.all([
    getUserCreditBalanceCents(user.id),
    listOrdersForUser(user.id, user.email),
    listCreditLedgerForUser(user.id),
  ]);

  return NextResponse.json(
    {
      user,
      creditBalanceCents,
      orders,
      ledger,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
