import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { downscaleImage } from '@/lib/image-resize';

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
  product_type: 'MADE_TO_ORDER' | 'PRODUCED';
  servings_per_batch: number;
  finished_goods_item_id: string | null;
  image_url: string | null;   // R2 public URL, or null when no photo uploaded
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
  productType: 'MADE_TO_ORDER' | 'PRODUCED';
  servingsPerBatch: number;
  finishedGoodsItemId: string | null;
  imageUrl: string | null;  // product.image_url — card background when present
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
    productType: p.product_type ?? 'MADE_TO_ORDER',
    servingsPerBatch: p.servings_per_batch ?? 1,
    finishedGoodsItemId: p.finished_goods_item_id ?? null,
    imageUrl: p.image_url ?? null,
  };
}

function mapCategory(c: CategoryRead): Category {
  return { id: c.id, label: c.name };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
// Catalog data (categories + products) changes rarely but is fetched on every POS
// open. Hold it fresh for 5 min and keep it in cache for 30 min so navigating away
// and back — or reopening the PWA within the window — renders instantly from cache
// instead of refetching the whole product list each time. Mutations still
// invalidate these keys, so edits show up immediately.
const CATALOG_STALE_TIME = 5 * 60_000;
const CATALOG_GC_TIME = 30 * 60_000;

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ['categories'],
    staleTime: CATALOG_STALE_TIME,
    gcTime: CATALOG_GC_TIME,
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
    staleTime: CATALOG_STALE_TIME,
    gcTime: CATALOG_GC_TIME,
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

interface ProductCreatePayload {
  name: string;
  category_id?: string;
  description?: string;
  price: number;
  is_active?: boolean;
  product_type?: 'MADE_TO_ORDER' | 'PRODUCED';
  servings_per_batch?: number;
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: ProductCreatePayload) =>
      api.post<ProductRead>('/api/v1/products', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      api.delete<void>(`/api/v1/products/${productId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

interface ProductUpdatePayload {
  productId: string;
  price?: number;
  category_id?: string | null;
  name?: string;
  product_type?: 'MADE_TO_ORDER' | 'PRODUCED';
  servings_per_batch?: number;
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, ...payload }: ProductUpdatePayload) =>
      api.patch<ProductRead>(`/api/v1/products/${productId}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-detail'] });
    },
  });
}

// ── Admin product management (full shape, no mapping) ─────────────────────────

export interface ProductReadAdmin {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductUpdateAdminPayload {
  category_id?: string | null;
  name?: string;
  description?: string | null;
  price?: string;
  is_active?: boolean;
}

export function useProductsAdmin() {
  return useQuery<ProductReadAdmin[]>({
    queryKey: ['products', 'admin'],
    queryFn: () => api.get<ProductReadAdmin[]>('/api/v1/products'),
  });
}

export function useUpdateProductAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, ...payload }: { productId: string } & ProductUpdateAdminPayload) =>
      api.patch<ProductReadAdmin>(`/api/v1/products/${productId}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

// ── Product image upload (Cloudflare R2, presigned direct upload) ──────────────
// 3-step flow (see HANDOFF_PRODUCT_IMAGES.md):
//   1. POST .../image-upload-url  → short-lived signed PUT URL + object key
//   2. PUT  {upload_url} raw bytes → straight to R2 (NOT through our API)
//   3. PUT  .../image {key}        → backend verifies + persists image_url
// The image is downscaled client-side first so the content_type we sign in
// step 1 matches the bytes we PUT in step 2 (R2 rejects a mismatch with 403).

interface ImageUploadUrlResponse {
  upload_url: string;
  key: string;
  public_url: string;
  expires_in: number;
}

export async function uploadProductImage(productId: string, file: File): Promise<string> {
  const blob = await downscaleImage(file);
  const contentType = blob.type || file.type;

  // 1. presigned URL — requested at upload time so the 5-min TTL never goes stale.
  const { upload_url, key } = await api.post<ImageUploadUrlResponse>(
    `/api/v1/products/${productId}/image-upload-url`,
    { content_type: contentType },
  );

  // 2. raw PUT straight to R2 — no auth header, Content-Type MUST match step 1.
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`อัปโหลดรูปไป R2 ไม่สำเร็จ (HTTP ${put.status})`);

  // 3. confirm — backend saves image_url and returns the updated product.
  const product = await api.put<ProductRead>(`/api/v1/products/${productId}/image`, { key });
  return product.image_url ?? '';
}

export function useUploadProductImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, file }: { productId: string; file: File }) =>
      uploadProductImage(productId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-detail'] });
    },
  });
}

export function useDeleteProductImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      api.delete<void>(`/api/v1/products/${productId}/image`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-detail'] });
    },
  });
}
