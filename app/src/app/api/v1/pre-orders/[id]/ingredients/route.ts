import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized, notFound } from '@/lib/auth-context';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { id } = await params;
  const threshold = Math.min(100, Math.max(0, Number(new URL(req.url).searchParams.get('threshold') ?? 50)));

  const preOrder = await db.preOrder.findFirst({
    where: { id, storeId: auth.storeId },
    include: {
      items: {
        include: {
          product: {
            include: {
              recipe: { include: { inventoryItem: true } },
            },
          },
        },
      },
    },
  });
  if (!preOrder) return notFound('PreOrder');

  // Aggregate ingredient requirements across all order items
  const aggregated = new Map<string, {
    inventoryItemId: string;
    name: string;
    unit: string;
    qtyNeeded: number;
    stockOnHand: number;
  }>();

  for (const orderItem of preOrder.items) {
    if (!orderItem.product) continue;
    for (const recipe of orderItem.product.recipe) {
      const qtyNeeded = Number(recipe.quantity) * orderItem.quantity;
      const existing = aggregated.get(recipe.inventoryItemId);
      if (existing) {
        existing.qtyNeeded += qtyNeeded;
      } else {
        aggregated.set(recipe.inventoryItemId, {
          inventoryItemId: recipe.inventoryItemId,
          name: recipe.inventoryItem.name,
          unit: recipe.inventoryItem.unit,
          qtyNeeded,
          stockOnHand: Number(recipe.inventoryItem.stockOnHand),
        });
      }
    }
  }

  // Check which items are on the shopping list
  const inventoryIds = Array.from(aggregated.keys());
  const onList = await db.shoppingListItem.findMany({
    where: { storeId: auth.storeId, inventoryItemId: { in: inventoryIds } },
    select: { inventoryItemId: true },
  });
  const onListSet = new Set(onList.map(s => s.inventoryItemId));

  const items = Array.from(aggregated.values()).map(agg => {
    const usagePct = agg.stockOnHand > 0
      ? (agg.qtyNeeded / agg.stockOnHand) * 100
      : null;
    return {
      inventory_item_id: agg.inventoryItemId,
      name: agg.name,
      unit: agg.unit,
      qty_needed: agg.qtyNeeded.toFixed(3),
      stock_on_hand: agg.stockOnHand.toFixed(3),
      usage_pct: usagePct !== null ? Math.round(usagePct * 10) / 10 : null,
      exceeds_threshold: usagePct !== null && usagePct > threshold,
      on_shopping_list: onListSet.has(agg.inventoryItemId),
    };
  });

  return NextResponse.json({ threshold, items });
}
