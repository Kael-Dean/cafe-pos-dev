import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized, badRequest } from '@/lib/auth-context';
import { Prisma, PreOrderStatus } from '@prisma/client';

const VALID_STATUSES: PreOrderStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function mapSummary(p: {
  id: string; orderDate: string; dueDate: string;
  customerName: string | null; customerPhone: string | null;
  status: PreOrderStatus; createdAt: Date;
  _count: { items: number };
}) {
  return {
    id: p.id,
    order_date: p.orderDate,
    due_date: p.dueDate,
    customer_name: p.customerName,
    customer_phone: p.customerPhone,
    status: p.status,
    item_count: p._count.items,
    created_at: p.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as PreOrderStatus | null;
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 50)));

  if (status && !VALID_STATUSES.includes(status)) {
    return badRequest('Invalid status value');
  }

  const where: Prisma.PreOrderWhereInput = {
    storeId: auth.storeId,
    ...(status ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    db.preOrder.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, orderDate: true, dueDate: true,
        customerName: true, customerPhone: true,
        status: true, createdAt: true,
        _count: { select: { items: true } },
      },
    }),
    db.preOrder.count({ where }),
  ]);

  return NextResponse.json({ items: items.map(mapSummary), total });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const body = await req.json();
  const {
    order_date, due_date, customer_name, customer_phone,
    deposit_amount, deposit_paid, notes, items,
  } = body;

  if (!due_date) return badRequest('due_date is required');
  if (!items?.length) return badRequest('items must not be empty');

  const productIds: string[] = items.map((i: { product_id: string }) => i.product_id);
  const products = await db.product.findMany({
    where: { id: { in: productIds }, storeId: auth.storeId },
    select: { id: true, name: true, basePrice: true },
  });
  const productMap = new Map(products.map(p => [p.id, p]));

  const itemsData = items.map((i: { product_id: string; quantity: number; unit_price?: string }) => {
    const product = productMap.get(i.product_id);
    if (!product) throw new Error(`Product ${i.product_id} not found`);
    const unitPrice = i.unit_price ? new Prisma.Decimal(i.unit_price) : product.basePrice;
    const qty = Math.max(1, Number(i.quantity) || 1);
    return {
      productId: i.product_id,
      productName: product.name,
      quantity: qty,
      unitPrice,
      lineTotal: unitPrice.mul(qty),
    };
  });

  const preOrder = await db.preOrder.create({
    data: {
      storeId: auth.storeId,
      orderDate: order_date ?? new Date().toISOString().split('T')[0],
      dueDate: due_date,
      customerName: customer_name?.trim() ?? null,
      customerPhone: customer_phone?.trim() ?? null,
      depositAmount: deposit_amount ? new Prisma.Decimal(deposit_amount) : null,
      depositPaid: deposit_paid ?? false,
      notes: notes?.trim() ?? null,
      createdById: auth.userId,
      items: { create: itemsData },
    },
    include: { items: true },
  });

  return NextResponse.json(mapDetail(preOrder), { status: 201 });
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
