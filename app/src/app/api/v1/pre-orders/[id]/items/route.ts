import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized, notFound, badRequest } from '@/lib/auth-context';
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { id } = await params;
  const preOrder = await db.preOrder.findFirst({ where: { id, storeId: auth.storeId } });
  if (!preOrder) return notFound('PreOrder');
  if (preOrder.status !== 'PENDING') {
    return badRequest('Can only add items to PENDING orders');
  }

  const body = await req.json();
  const { product_id, quantity, unit_price } = body;
  if (!product_id) return badRequest('product_id is required');

  const product = await db.product.findFirst({
    where: { id: product_id, storeId: auth.storeId },
    select: { id: true, name: true, basePrice: true },
  });
  if (!product) return notFound('Product');

  const qty = Math.max(1, Number(quantity) || 1);
  const unitPrice = unit_price ? new Prisma.Decimal(unit_price) : product.basePrice;

  await db.preOrderItem.create({
    data: {
      preOrderId: id,
      productId: product.id,
      productName: product.name,
      quantity: qty,
      unitPrice,
      lineTotal: unitPrice.mul(qty),
    },
  });

  const updated = await db.preOrder.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  });

  return NextResponse.json(mapDetail(updated));
}
