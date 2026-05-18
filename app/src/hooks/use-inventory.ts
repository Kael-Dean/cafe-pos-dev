import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (exact field names from schemas/inventory.py) ──────────────
interface InventoryItemRead {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: string | number;   // Decimal serialised as string
  stock_on_hand: string | number;   // Decimal serialised as string
  par_level: string | number;       // Decimal serialised as string
  is_active: boolean;
  status: 'ok' | 'low' | 'critical';
  unit_size: string | null;
  unit_price: string | null;        // Cost of one purchased package
}

export interface SupplierHistoryItem {
  supplier: string | null;
  unit_cost: string | null;
  quantity: string;
  received_at: string;
  note: string | null;
}

export type MovementType =
  | 'RECEIVE' | 'SALE' | 'WASTE' | 'ADJUST'
  | 'TRANSFER_IN' | 'TRANSFER_OUT';

export type WastageReason =
  | 'EXPIRED' | 'SPILLED' | 'TRIAL' | 'DAMAGED' | 'OTHER';

interface CreatedBy { id: string; name: string; }

interface StockMovementRead {
  id: string;
  type: MovementType;
  inventory_item_id: string;
  quantity: string | number;
  reason_code: WastageReason | null;
  note: string | null;
  supplier: string | null;
  created_by: CreatedBy;
  created_at: string;
}

interface MovementsPage {
  items: StockMovementRead[];
  next_cursor: string | null;
}

// ── Receipt & Lot backend shapes ───────────────────────────────────────────────
interface StockLotRead {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  qty_packs: string;
  qty_received: string;
  qty_remaining: string;
  unit_price: string;
  cost_per_unit: string;
  expiry_date: string | null;
  created_at: string;
}

interface StockReceiptRead {
  id: string;
  status: 'DRAFT' | 'CONFIRMED';
  supplier_name: string | null;
  receipt_ref: string | null;
  note: string | null;
  received_at: string;
  created_by: CreatedBy;
  created_at: string;
  lots: StockLotRead[];
}

interface ReceiptSummary {
  id: string;
  status: 'DRAFT' | 'CONFIRMED';
  supplier_name: string | null;
  receipt_ref: string | null;
  received_at: string;
  lot_count: number;
  created_at: string;
}

interface ReceiptsPage {
  items: ReceiptSummary[];
  next_cursor: string | null;
}

// ── Frontend shapes (what the screens expect) ─────────────────────────────────
export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  stock: number;
  parLevel: number;
  unitSize: string | null;
  unitPrice: string | null;
}

export interface Movement {
  id: string;
  invId: string;
  type: MovementType;
  qty: number;
  costPerUnit?: number;
  supplier?: string;
  note?: string;
  reason?: WastageReason;
  user: string;
  at: number;
}

export interface StockLot {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  qtyPacks: number;
  qtyReceived: number;
  qtyRemaining: number;
  unitPrice: number;
  costPerUnit: number;
  expiryDate: string | null;
  createdAt: string;
}

export interface StockReceipt {
  id: string;
  status: 'DRAFT' | 'CONFIRMED';
  supplierName: string | null;
  receiptRef: string | null;
  note: string | null;
  receivedAt: string;
  createdBy: CreatedBy;
  createdAt: string;
  lots: StockLot[];
}

export interface ReceiptListItem {
  id: string;
  status: 'DRAFT' | 'CONFIRMED';
  supplierName: string | null;
  receiptRef: string | null;
  receivedAt: string;
  lotCount: number;
  createdAt: string;
}

export interface ExpiredLotRead {
  lot_id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  unit: string;
  qty_remaining: string;
  expiry_date: string;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
function mapItem(i: InventoryItemRead): InventoryItem {
  return {
    id: i.id,
    name: i.name,
    unit: i.unit,
    costPerUnit: Number(i.cost_per_unit),
    stock: Number(i.stock_on_hand),
    parLevel: Number(i.par_level),
    unitSize: i.unit_size,
    unitPrice: i.unit_price,
  };
}

function mapMovement(m: StockMovementRead): Movement {
  return {
    id: m.id,
    invId: m.inventory_item_id,
    type: m.type,
    qty: Number(m.quantity),
    supplier: m.supplier ?? undefined,
    note: m.note ?? undefined,
    reason: m.reason_code ?? undefined,
    user: m.created_by?.name ?? '—',
    at: new Date(m.created_at).getTime(),
  };
}

function mapLot(l: StockLotRead): StockLot {
  return {
    id: l.id,
    inventoryItemId: l.inventory_item_id,
    inventoryItemName: l.inventory_item_name,
    qtyPacks: Number(l.qty_packs),
    qtyReceived: Number(l.qty_received),
    qtyRemaining: Number(l.qty_remaining),
    unitPrice: Number(l.unit_price),
    costPerUnit: Number(l.cost_per_unit),
    expiryDate: l.expiry_date,
    createdAt: l.created_at,
  };
}

function mapReceipt(r: StockReceiptRead): StockReceipt {
  return {
    id: r.id,
    status: r.status,
    supplierName: r.supplier_name,
    receiptRef: r.receipt_ref,
    note: r.note,
    receivedAt: r.received_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lots: r.lots.map(mapLot),
  };
}

function mapReceiptSummary(r: ReceiptSummary): ReceiptListItem {
  return {
    id: r.id,
    status: r.status,
    supplierName: r.supplier_name,
    receiptRef: r.receipt_ref,
    receivedAt: r.received_at,
    lotCount: r.lot_count,
    createdAt: r.created_at,
  };
}

// ── Inventory hooks ───────────────────────────────────────────────────────────
export function useInventory(search?: string) {
  return useQuery<InventoryItem[]>({
    queryKey: ['inventory', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const qs = params.toString() ? `?${params}` : '';
      const data = await api.get<InventoryItemRead[]>(`/api/v1/inventory${qs}`);
      return data.map(mapItem);
    },
  });
}

export function useInventoryMovements(limit = 200) {
  return useQuery<Movement[]>({
    queryKey: ['inventory-movements', limit],
    queryFn: async () => {
      const data = await api.get<MovementsPage>(`/api/v1/inventory/movements?limit=${limit}`);
      return data.items.map(mapMovement);
    },
  });
}

interface WastePayload {
  item_id: string;
  qty: number;
  reason: WastageReason;   // field is "reason" in WasteRequest, NOT "wastage_reason"
  note?: string;
}

interface AdjustPayload {
  item_id: string;
  delta: number;           // positive = add, negative = remove
  reason: string;          // free-text explanation (min 3 chars)
}

export function useWasteStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: WastePayload) =>
      api.post('/api/v1/inventory/waste', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: AdjustPayload) =>
      api.post('/api/v1/inventory/adjust', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
  });
}

interface InventoryItemCreatePayload {
  name: string;
  unit: string;
  unit_size: string;
  par_level?: string;
  is_active?: boolean;
}

export function useCreateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: InventoryItemCreatePayload) =>
      api.post<InventoryItemRead>('/api/v1/inventory', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      api.delete<void>(`/api/v1/inventory/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-expired'] });
    },
  });
}

export function useExpiredInventory() {
  return useQuery<ExpiredLotRead[]>({
    queryKey: ['inventory-expired'],
    queryFn: () => api.get<ExpiredLotRead[]>('/api/v1/inventory/expired'),
  });
}

export function useSupplierHistory(itemId: string | null) {
  return useQuery<SupplierHistoryItem[]>({
    queryKey: ['inventory-supplier-history', itemId],
    queryFn: () => api.get<SupplierHistoryItem[]>(`/api/v1/inventory/${itemId}/supplier-history`),
    enabled: !!itemId,
  });
}

// ── Lot detail per ingredient ─────────────────────────────────────────────────
export function useItemLots(itemId: string | null, status: 'active' | 'all' = 'active') {
  return useQuery<StockLot[]>({
    queryKey: ['inventory-lots', itemId, status],
    queryFn: async () => {
      const data = await api.get<StockLotRead[]>(`/api/v1/inventory/${itemId}/lots?status=${status}`);
      return data.map(mapLot);
    },
    enabled: !!itemId,
  });
}

// ── Receipt hooks ─────────────────────────────────────────────────────────────
interface CreateReceiptPayload {
  supplier_name?: string;
  receipt_ref?: string;
  note?: string;
  received_at?: string;
}

interface AddLotPayload {
  inventory_item_id: string;
  qty_packs: string;
  unit_price: string;
  expiry_date?: string;
}

export function useCreateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: CreateReceiptPayload) =>
      api.post<StockReceiptRead>('/api/v1/receipts', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useReceipts(status?: 'DRAFT' | 'CONFIRMED') {
  return useQuery<ReceiptListItem[]>({
    queryKey: ['receipts', status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const qs = params.toString() ? `?${params}` : '';
      const data = await api.get<ReceiptsPage>(`/api/v1/receipts${qs}`);
      return data.items.map(mapReceiptSummary);
    },
  });
}

export function useReceipt(id: string | null) {
  return useQuery<StockReceipt>({
    queryKey: ['receipt', id],
    queryFn: async () => {
      const data = await api.get<StockReceiptRead>(`/api/v1/receipts/${id}`);
      return mapReceipt(data);
    },
    enabled: !!id,
  });
}

export function useAddLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ receiptId, lot }: { receiptId: string; lot: AddLotPayload }) =>
      api.post<StockReceiptRead>(`/api/v1/receipts/${receiptId}/lots`, lot),
    onSuccess: (_data, { receiptId }) => {
      qc.invalidateQueries({ queryKey: ['receipt', receiptId] });
    },
  });
}

export function useDeleteLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ receiptId, lotId }: { receiptId: string; lotId: string }) =>
      api.delete<void>(`/api/v1/receipts/${receiptId}/lots/${lotId}`),
    onSuccess: (_data, { receiptId }) => {
      qc.invalidateQueries({ queryKey: ['receipt', receiptId] });
    },
  });
}

export function useConfirmReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (receiptId: string) =>
      api.post<StockReceiptRead>(`/api/v1/receipts/${receiptId}/confirm`, {}),
    onSuccess: (_data, receiptId) => {
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['receipt', receiptId] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
  });
}
