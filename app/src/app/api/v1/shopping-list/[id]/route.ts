import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized, notFound } from '@/lib/auth-context';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { id } = await params;

  const existing = await db.shoppingListItem.findFirst({
    where: { id, storeId: auth.storeId },
  });
  if (!existing) return notFound('ShoppingListItem');

  await db.shoppingListItem.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
