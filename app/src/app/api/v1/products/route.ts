import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthContext, unauthorized } from '@/lib/auth-context';

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized();

  const { searchParams } = new URL(req.url);
  const isActive = searchParams.get('is_active');
  const categoryId = searchParams.get('category_id');
  const search = searchParams.get('search');

  const products = await db.product.findMany({
    where: {
      storeId: auth.storeId,
      ...(isActive !== null ? { isActive: isActive === 'true' } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json(
    products.map(p => ({
      id: p.id,
      store_id: p.storeId,
      category_id: p.categoryId,
      name: p.name,
      description: p.description,
      price: p.basePrice.toString(),
      is_active: p.isActive,
      created_at: p.createdAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
    }))
  );
}
