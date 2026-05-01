import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (exact field names from schemas/catalog.py) ────────────────
interface CategoryRead {
  id: string;
  store_id: string;
  name: string;
  sort_order: number;   // NOT display_order
  is_active: boolean;
}

interface ProductRead {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;            // single name field (no name_th / name_en)
  description: string | null;
  price: string | number;  // Decimal serialised as string
  is_active: boolean;
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface MenuItem {
  id: string;
  name: string;
  nameEn: string;       // same as name (no separate English field in API)
  price: number;
  cat: string;          // category_id UUID
  hot: boolean;         // always false (no is_featured in API)
  color: string;        // generated from id
  tag: string;          // first 2 chars of name
  needsModifier: boolean; // set to true in POS when modifier groups exist
}

export interface Category {
  id: string;
  label: string;
}

// Stable colour derived from UUID (so each product keeps its colour across renders)
function colorFromId(id: string): string {
  const palette = [
    '#3D2817', '#5C3B22', '#8B6F47', '#A57854',
    '#7FA572', '#D88B4E', '#2A1A0F', '#4A2C1A',
    '#9A6E3F', '#C49A6E',
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function mapProduct(p: ProductRead): MenuItem {
  return {
    id: p.id,
    name: p.name,
    nameEn: p.name,
    price: Number(p.price),
    cat: p.category_id ?? '',
    hot: false,
    color: colorFromId(p.id),
    tag: p.name.slice(0, 2).toUpperCase(),
    needsModifier: false, // POS overrides this at render time
  };
}

function mapCategory(c: CategoryRead): Category {
  return { id: c.id, label: c.name };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const data = await api.get<CategoryRead[]>('/api/v1/categories');
      return data
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(mapCategory);
    },
  });
}

export function useAllProducts() {
  return useQuery<MenuItem[]>({
    queryKey: ['products', 'all'],
    queryFn: async () => {
      const data = await api.get<ProductRead[]>('/api/v1/products?is_active=true');
      return data.map(mapProduct);
    },
  });
}

// Used by BOM builder (filtered list)
export function useProducts(categoryId?: string, search?: string) {
  return useQuery<MenuItem[]>({
    queryKey: ['products', categoryId, search],
    queryFn: async () => {
      const params = new URLSearchParams({ is_active: 'true' });
      if (categoryId) params.set('category_id', categoryId);
      if (search) params.set('search', search);
      const data = await api.get<ProductRead[]>(`/api/v1/products?${params}`);
      return data.map(mapProduct);
    },
    enabled: !!categoryId,
  });
}
