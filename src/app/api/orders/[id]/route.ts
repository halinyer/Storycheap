import { NextResponse, type NextRequest } from "next/server";
import { getServerSessionUser } from "@/lib/server/auth";
import { hasOrderAccessCookie } from "@/lib/server/order-access";
import { getOrderById } from "@/lib/server/repository";
import { ORDER_STATUS_META } from "@/lib/server/state-machine";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const order = await getOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  const sessionUser = await getServerSessionUser();
  const isOwner = Boolean(sessionUser && order.userId === sessionUser.id);
  const isAdmin = Boolean(sessionUser?.role === "admin");
  const hasCookieCap = await hasOrderAccessCookie(order.id);

  if (!isOwner && !isAdmin && !hasCookieCap) {
    return NextResponse.json(
      { error: "No autorizado para consultar esta orden." },
      { status: 403 }
    );
  }

  const sanitizedOrder = isAdmin
    ? order
    : {
        ...order,
        items: order.items.map(({ unitCostCents: _omit, ...rest }) => {
          void _omit;
          return rest;
        }),
      };

  return NextResponse.json(
    {
      order: sanitizedOrder,
      statusMeta: ORDER_STATUS_META[order.status],
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
