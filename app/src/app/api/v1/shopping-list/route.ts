import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized, badRequest } from '@/lib/auth-context';

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const items = await db.shoppingListItem.findMany({
    where: { storeId: auth.storeId },
    include: { inventoryItem: { select: { name: true, unit: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(
    items.map(i => ({
      id: i.id,
      inventory_item_id: i.inventoryItemId,
      inventory_item_name: i.inventoryItem.name,
      unit: i.inventoryItem.unit,
      note: i.note,
      added_by_id: i.addedById,
      created_at: i.createdAt.toISOString(),
    }))
  );
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const body = await req.json();
  const { inventory_item_id, note } = body;
  if (!inventory_item_id) return badRequest('inventory_item_id is required');

  const item = await db.shoppingListItem.upsert({
    where: { storeId_inventoryItemId: { storeId: auth.storeId, inventoryItemId: inventory_item_id } },
    create: {
      storeId: auth.storeId,
      inventoryItemId: inventory_item_id,
      note: note ?? null,
      addedById: auth.userId,
    },
    update: { note: note ?? null },
    include: { inventoryItem: { select: { name: true, unit: true } } },
  });

  return NextResponse.json({
    id: item.id,
    inventory_item_id: item.inventoryItemId,
    inventory_item_name: item.inventoryItem.name,
    unit: item.inventoryItem.unit,
    note: item.note,
    added_by_id: item.addedById,
    created_at: item.createdAt.toISOString(),
  }, { status: 201 });
}
