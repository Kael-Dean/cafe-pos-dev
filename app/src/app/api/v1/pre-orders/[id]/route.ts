import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized, notFound } from '@/lib/auth-context';
import { Prisma } from '@prisma/client';

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { id } = await params;
  const preOrder = await db.preOrder.findFirst({
    where: { id, storeId: auth.storeId },
    include: { items: true },
  });
  if (!preOrder) return notFound('PreOrder');

  return NextResponse.json(mapDetail(preOrder));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { id } = await params;
  const existing = await db.preOrder.findFirst({ where: { id, storeId: auth.storeId } });
  if (!existing) return notFound('PreOrder');

  const body = await req.json();
  const {
    order_date, due_date, customer_name, customer_phone,
    deposit_amount, deposit_paid, notes,
  } = body;

  const preOrder = await db.preOrder.update({
    where: { id },
    data: {
      ...(order_date !== undefined ? { orderDate: order_date } : {}),
      ...(due_date !== undefined ? { dueDate: due_date } : {}),
      ...(customer_name !== undefined ? { customerName: customer_name ?? null } : {}),
      ...(customer_phone !== undefined ? { customerPhone: customer_phone ?? null } : {}),
      ...(deposit_amount !== undefined ? { depositAmount: deposit_amount ? new Prisma.Decimal(deposit_amount) : null } : {}),
      ...(deposit_paid !== undefined ? { depositPaid: deposit_paid } : {}),
      ...(notes !== undefined ? { notes: notes?.trim() ?? null } : {}),
    },
    include: { items: true },
  });

  return NextResponse.json(mapDetail(preOrder));
}
