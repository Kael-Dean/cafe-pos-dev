import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Enums & backend shapes ────────────────────────────────────────────────────
export type PreOrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

interface PreOrderItemRead {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

interface PreOrderRead {
  id: string;
  store_id: string;
  order_date: string;
  due_date: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  deposit_amount: string | null;
  deposit_paid: boolean;
  notes: string | null;
  status: PreOrderStatus;
  created_by_id: string;
  started_by_id: string | null;
  completed_by_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  items: PreOrderItemRead[];
  created_at: string;
  updated_at: string;
}

interface PreOrderSummaryRead {
  id: string;
  order_date: string;
  due_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: PreOrderStatus;
  item_count: number;
  created_at: string;
}

interface PreOrdersPageRead {
  items: PreOrderSummaryRead[];
  total: number;
}

interface IngredientLineRead {
  inventory_item_id: string;
  name: string;
  unit: string;
  qty_needed: string;
  stock_on_hand: string;
  usage_pct: number | null;
  exceeds_threshold: boolean;
  on_shopping_list: boolean;
}

interface IngredientSummaryRead {
  threshold: number;
  items: IngredientLineRead[];
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface PreOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface PreOrder {
  id: string;
  storeId: string;
  orderDate: string;
  dueDate: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  depositAmount: string | null;
  depositPaid: boolean;
  notes: string | null;
  status: PreOrderStatus;
  createdById: string;
  startedById: string | null;
  completedById: string | null;
  startedAt: string | null;
  completedAt: string | null;
  items: PreOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PreOrderListItem {
  id: string;
  orderDate: string;
  dueDate: string;
  customerName: string | null;
  customerPhone: string | null;
  status: PreOrderStatus;
  itemCount: number;
  createdAt: string;
}

export interface IngredientLine {
  inventoryItemId: string;
  name: string;
  unit: string;
  qtyNeeded: string;
  stockOnHand: string;
  usagePct: number | null;
  exceedsThreshold: boolean;
  onShoppingList: boolean;
}

export interface IngredientsResult {
  threshold: number;
  items: IngredientLine[];
}

// ── Mappers ───────────────────────────────────────────────────────────────────
function mapOrderItem(i: PreOrderItemRead): PreOrderItem {
  return {
    id: i.id,
    productId: i.product_id,
    productName: i.product_name,
    quantity: i.quantity,
    unitPrice: i.unit_price,
    lineTotal: i.line_total,
  };
}

function mapPreOrder(p: PreOrderRead): PreOrder {
  return {
    id: p.id,
    storeId: p.store_id,
    orderDate: p.order_date,
    dueDate: p.due_date,
    customerId: p.customer_id,
    customerName: p.customer_name,
    customerPhone: p.customer_phone,
    depositAmount: p.deposit_amount,
    depositPaid: p.deposit_paid,
    notes: p.notes,
    status: p.status,
    createdById: p.created_by_id,
    startedById: p.started_by_id,
    completedById: p.completed_by_id,
    startedAt: p.started_at,
    completedAt: p.completed_at,
    items: p.items.map(mapOrderItem),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function mapListItem(s: PreOrderSummaryRead): PreOrderListItem {
  return {
    id: s.id,
    orderDate: s.order_date,
    dueDate: s.due_date,
    customerName: s.customer_name,
    customerPhone: s.customer_phone,
    status: s.status,
    itemCount: s.item_count,
    createdAt: s.created_at,
  };
}

function mapIngredientLine(i: IngredientLineRead): IngredientLine {
  return {
    inventoryItemId: i.inventory_item_id,
    name: i.name,
    unit: i.unit,
    qtyNeeded: i.qty_needed,
    stockOnHand: i.stock_on_hand,
    usagePct: i.usage_pct,
    exceedsThreshold: i.exceeds_threshold,
    onShoppingList: i.on_shopping_list,
  };
}

// ── Read hooks ────────────────────────────────────────────────────────────────
export function usePreOrders(status?: PreOrderStatus, page = 1, limit = 50) {
  return useQuery<{ items: PreOrderListItem[]; total: number }>({
    queryKey: ['pre-orders', status, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const data = await api.get<PreOrdersPageRead>(`/api/v1/pre-orders?${params}`);
      return { items: data.items.map(mapListItem), total: data.total };
    },
  });
}

export function usePreOrder(id: string | null) {
  return useQuery<PreOrder>({
    queryKey: ['pre-order', id],
    queryFn: async () => {
      if (!id) throw new Error('id is required');
      const data = await api.get<PreOrderRead>(`/api/v1/pre-orders/${id}`);
      return mapPreOrder(data);
    },
    enabled: !!id,
  });
}

export function usePreOrderIngredients(id: string | null, threshold = 50) {
  return useQuery<IngredientsResult>({
    queryKey: ['pre-order-ingredients', id, threshold],
    queryFn: async () => {
      if (!id) throw new Error('id is required');
      const data = await api.get<IngredientSummaryRead>(
        `/api/v1/pre-orders/${id}/ingredients?threshold=${threshold}`
      );
      return { threshold: data.threshold, items: data.items.map(mapIngredientLine) };
    },
    enabled: !!id,
  });
}

// ── Mutation payloads ─────────────────────────────────────────────────────────
export interface CreatePreOrderItemPayload {
  product_id: string;
  quantity: number;
  unit_price?: string;
}

export interface CreatePreOrderPayload {
  order_date: string;
  due_date: string;
  customer_name?: string;
  customer_phone?: string;
  customer_id?: string;
  deposit_amount?: string;
  deposit_paid?: boolean;
  notes?: string;
  items: CreatePreOrderItemPayload[];
}

export interface UpdatePreOrderPayload {
  order_date?: string;
  due_date?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_id?: string | null;
  deposit_amount?: string;
  deposit_paid?: boolean;
  notes?: string;
}

// ── Mutation hooks ────────────────────────────────────────────────────────────
export function useCreatePreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: CreatePreOrderPayload) =>
      api.post<PreOrderRead>('/api/v1/pre-orders', p).then(mapPreOrder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
    },
  });
}

export function useUpdatePreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePreOrderPayload }) =>
      api.patch<PreOrderRead>(`/api/v1/pre-orders/${id}`, data).then(mapPreOrder),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
    },
  });
}

export function useAddPreOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, item }: { id: string; item: CreatePreOrderItemPayload }) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/items`, item).then(mapPreOrder),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
      qc.invalidateQueries({ queryKey: ['pre-order-ingredients', id] });
    },
  });
}

export function useRemovePreOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: string; itemId: string }) =>
      api.delete<PreOrderRead>(`/api/v1/pre-orders/${orderId}/items/${itemId}`).then(mapPreOrder),
    onSuccess: (_res, { orderId }) => {
      qc.invalidateQueries({ queryKey: ['pre-order', orderId] });
      qc.invalidateQueries({ queryKey: ['pre-order-ingredients', orderId] });
    },
  });
}

export function useStartPreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/start`, {}).then(mapPreOrder),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
  });
}

export function useCompletePreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/complete`, {}).then(mapPreOrder),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
    },
  });
}

export function useCancelPreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/cancel`, {}).then(mapPreOrder),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
    },
  });
}
