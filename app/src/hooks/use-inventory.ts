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
  expiry_date: string | null;       // ISO date "YYYY-MM-DD"
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

// ── Frontend shapes (what the screens expect) ─────────────────────────────────
export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  stock: number;
  parLevel: number;
  expiryDate?: string;  // ISO "YYYY-MM-DD", undefined = no expiry set
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

function mapItem(i: InventoryItemRead): InventoryItem {
  return {
    id: i.id,
    name: i.name,
    unit: i.unit,
    costPerUnit: Number(i.cost_per_unit),
    stock: Number(i.stock_on_hand),
    parLevel: Number(i.par_level),
    expiryDate: i.expiry_date ?? undefined,
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

// ── Hooks ─────────────────────────────────────────────────────────────────────
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

// Payload shapes matching backend schemas exactly
interface ReceivePayload {
  item_id: string;
  qty: number;
  cost_per_unit: number;
  supplier?: string;
  note?: string;
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

export function useReceiveStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: ReceivePayload) =>
      api.post('/api/v1/inventory/receive', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
  });
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
  par_level: number;
  cost_per_unit: number;
  is_active?: boolean;
  expiry_date?: string;
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
    },
  });
}
