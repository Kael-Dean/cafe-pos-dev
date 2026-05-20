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

  const updated = await db.$transaction(async (tx) => {
    const preOrder = await tx.preOrder.findFirst({
      where: { id, storeId: auth.storeId },
      include: {
        items: {
          include: {
            product: { include: { recipe: true } },
          },
        },
      },
    });
    if (!preOrder) throw new Error('NOT_FOUND');
    if (preOrder.status !== 'PENDING') throw new Error('INVALID_STATUS');

    // Deduct stock for each recipe item
    for (const orderItem of preOrder.items) {
      if (!orderItem.product) continue;
      for (const recipe of orderItem.product.recipe) {
        const totalQty = new Prisma.Decimal(recipe.quantity).mul(orderItem.quantity);

        await tx.inventoryItem.update({
          where: { id: recipe.inventoryItemId },
          data: { stockOnHand: { decrement: totalQty } },
        });

        await tx.stockMovement.create({
          data: {
            storeId: auth.storeId,
            inventoryItemId: recipe.inventoryItemId,
            type: 'SALE',
            quantity: totalQty,
            reason: `Pre-order production: ${preOrder.id}`,
            createdById: auth.userId,
          },
        });
      }
    }

    return tx.preOrder.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        startedById: auth.userId,
        startedAt: new Date(),
      },
      include: { items: true },
    });
  }).catch((err: Error) => {
    if (err.message === 'NOT_FOUND') throw { status: 404 };
    if (err.message === 'INVALID_STATUS') throw { status: 400, msg: 'Order must be PENDING to start' };
    throw err;
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
