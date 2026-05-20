import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized, notFound, badRequest } from '@/lib/auth-context';
import { Prisma } from '@prisma/client';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { id } = await params;

  const preOrder = await db.preOrder.findFirst({ where: { id, storeId: auth.storeId } });
  if (!preOrder) return notFound('PreOrder');
  if (preOrder.status === 'COMPLETED' || preOrder.status === 'CANCELLED') {
    return badRequest(`Cannot cancel a ${preOrder.status} order`);
  }

  const updated = await db.preOrder.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: { items: true },
  });

  return NextResponse.json(mapDetail(updated));
}

function mapDetail(p: Prisma.PreOrderGetPayload<{ include: { items: true } }>) {
  return {
    id: p.id,
    store_id: p.storeId,
    order_date: p.orderDate,
    due_date: p.dueDate,
    customer_id: p.customerId,
    customer_name: p.customerName,
    customer_phone: p.customerPhone,
    deposit_amount: p.depositAmount?.toString() ?? null,
    deposit_paid: p.depositPaid,
    notes: p.notes,
    status: p.status,
    created_by_id: p.createdById,
    started_by_id: p.startedById,
    completed_by_id: p.completedById,
    started_at: p.startedAt?.toISOString() ?? null,
    completed_at: p.completedAt?.toISOString() ?? null,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    items: p.items.map(i => ({
      id: i.id,
      product_id: i.productId,
      product_name: i.productName,
      quantity: i.quantity,
      unit_price: i.unitPrice.toString(),
      line_total: i.lineTotal.toString(),
    })),
  };
}
