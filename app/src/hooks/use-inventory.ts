import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (exact field names from schemas/inventory.py) ──────────────

// A pack is a *way of buying* an ingredient (brand/size combo) — "Meiji 2L",
// "Dutch Mill 1L". Packs belong to the purchase, not to the ingredient, so the
// recipe keeps pointing at "Whole Milk" while the cost follows whatever's in stock.
interface PackRead {
  id: string;
  inventory_item_id: string;
  label: string;
  pack_size: string;                // Decimal — stock units per pack
  last_price: string | null;        // UI pre-fill only, not authoritative cost
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Where cost_per_unit came from: a manager's pin, FIFO's oldest lot, or nothing yet.
export type CostSource = 'manual' | 'fifo' | 'none';

interface InventoryItemRead {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: string | number;   // Decimal — cost of the lot currently consumed
  stock_on_hand: string | number;   // Decimal serialised as string
  par_level: string | number;       // Decimal serialised as string
  is_active: boolean;
  status: 'ok' | 'low' | 'critical';
  packs: PackRead[];                // active only, default first
  default_pack_id: string | null;
  in_use_lot_id: string | null;     // null = FIFO
  cost_source: CostSource;
  // Deprecated — read-only mirrors of the default pack, removed next release.
  unit_size: string | null;
  unit_price: string | null;
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

// CANCELED is set by the backend on order-cancel write-offs — it is a valid
// movement reason_code but is NOT user-selectable in the manual wastage form.
export type WastageReason =
  | 'EXPIRED' | 'SPILLED' | 'TRIAL' | 'DAMAGED' | 'CANCELED' | 'OTHER';

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
// A lot freezes the pack it was bought in, so renaming or resizing a pack later
// never rewrites history. pack_id/pack_label are null for void-restock lots.
interface StockLotRead {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  pack_id: string | null;
  pack_label: string | null;
  qty_packs: string;
  qty_received: string;
  qty_remaining: string;
  pack_price: string;
  unit_price: string;               // deprecated alias of pack_price
  cost_per_unit: string;
  expiry_date: string | null;
  received_at: string;
  supplier_name: string | null;
  is_in_use: boolean;               // the item's manually pinned lot
  is_head: boolean;                 // pinned if set, else FIFO oldest
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
export interface Pack {
  id: string;
  itemId: string;
  label: string;
  packSize: number;
  lastPrice: number | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  stock: number;
  parLevel: number;
  packs: Pack[];
  defaultPackId: string | null;
  inUseLotId: string | null;
  costSource: CostSource;
  /** @deprecated mirrors the default pack — removed next release */
  unitSize: string | null;
  /** @deprecated mirrors the default pack — removed next release */
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
  packId: string | null;
  packLabel: string | null;
  qtyPacks: number;
  qtyReceived: number;
  qtyRemaining: number;
  packPrice: number;
  /** @deprecated alias of packPrice */
  unitPrice: number;
  costPerUnit: number;
  expiryDate: string | null;
  receivedAt: string;
  supplierName: string | null;
  isInUse: boolean;
  isHead: boolean;
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

export interface ExpiredLot {
  lotId: string;
  itemId: string;
  itemName: string;
  unit: string;
  qtyRemaining: number;
  expiryDate: string;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
function mapPack(p: PackRead): Pack {
  return {
    id: p.id,
    itemId: p.inventory_item_id,
    label: p.label,
    packSize: Number(p.pack_size),
    lastPrice: p.last_price === null ? null : Number(p.last_price),
    isDefault: p.is_default,
    isActive: p.is_active,
  };
}

function mapItem(i: InventoryItemRead): InventoryItem {
  return {
    id: i.id,
    name: i.name,
    unit: i.unit,
    costPerUnit: Number(i.cost_per_unit),
    stock: Number(i.stock_on_hand),
    parLevel: Number(i.par_level),
    packs: (i.packs ?? []).map(mapPack),
    defaultPackId: i.default_pack_id ?? null,
    inUseLotId: i.in_use_lot_id ?? null,
    costSource: i.cost_source ?? 'none',
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
  // pack_price is the new field; unit_price is its deprecated alias. Read either
  // so a lot from an older payload still prices correctly.
  const price = Number(l.pack_price ?? l.unit_price);
  return {
    id: l.id,
    inventoryItemId: l.inventory_item_id,
    inventoryItemName: l.inventory_item_name,
    packId: l.pack_id ?? null,
    packLabel: l.pack_label ?? null,
    qtyPacks: Number(l.qty_packs),
    qtyReceived: Number(l.qty_received),
    qtyRemaining: Number(l.qty_remaining),
    packPrice: price,
    unitPrice: price,
    costPerUnit: Number(l.cost_per_unit),
    expiryDate: l.expiry_date,
    receivedAt: l.received_at ?? l.created_at,
    supplierName: l.supplier_name ?? null,
    isInUse: l.is_in_use ?? false,
    isHead: l.is_head ?? false,
    createdAt: l.created_at,
  };
}

function mapExpiredLot(l: ExpiredLotRead): ExpiredLot {
  return {
    lotId: l.lot_id,
    itemId: l.inventory_item_id,
    itemName: l.inventory_item_name,
    unit: l.unit,
    qtyRemaining: Number(l.qty_remaining),
    expiryDate: l.expiry_date,
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

export interface PackCreatePayload {
  label: string;
  pack_size: string;
  last_price?: string;
  is_default?: boolean;
}

interface InventoryItemCreatePayload {
  name: string;
  unit: string;
  // The first pack becomes the default unless one is flagged is_default.
  packs: PackCreatePayload[];
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

// ── Recycle bin (soft-deleted inventory items) ────────────────────────────────
// "Delete" sets is_active=false; these list/restore those rows. OWNER/MANAGER
// only (backend enforces; the screen is gated too).
export function useDeletedInventory() {
  return useQuery<InventoryItem[]>({
    queryKey: ['inventory', 'deleted'],
    queryFn: async () => {
      const data = await api.get<InventoryItemRead[]>('/api/v1/inventory/deleted');
      return data.map(mapItem);
    },
  });
}

export function useRestoreInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    // Idempotent on the backend — restoring an already-active item is a 200.
    mutationFn: (itemId: string) =>
      api.post<InventoryItemRead>(`/api/v1/inventory/${itemId}/restore`, {}),
    onSuccess: () => {
      // ['inventory'] prefix covers ['inventory','deleted'] (row leaves) and the
      // active lists ['inventory', search] (item reappears).
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-expired'] });
    },
  });
}

// Lots whose expiry_date has passed and still have stock, oldest expiry first.
// Both this and POST /inventory/expired/waste evaluate "expired" against the Bangkok
// calendar date, and lots on inactive (soft-deleted) items are excluded here — so a
// skip reason of `inactive_item` only comes back when an item was deactivated between
// this fetch and the confirm.
export function useExpiredInventory() {
  return useQuery<ExpiredLot[]>({
    queryKey: ['inventory-expired'],
    queryFn: async () => {
      const data = await api.get<ExpiredLotRead[]>('/api/v1/inventory/expired');
      return data.map(mapExpiredLot);
    },
  });
}

// ── Expired-lot batch waste ───────────────────────────────────────────────────
// Confirms a batch of expired lots as wasted: one WASTE movement per accepted lot for
// its full remaining quantity, reason EXPIRED. Always 200 — per-lot problems come back
// in `skipped`, never as 404/409. The whole batch is one transaction.
export type ExpiredWasteSkipReason = 'not_found' | 'not_expired' | 'empty' | 'inactive_item';

interface ExpiredWasteSkipRead {
  lot_id: string;
  reason: string;
}

interface ExpiredWasteResultRead {
  wasted: string[];
  skipped: ExpiredWasteSkipRead[];
}

export interface ExpiredWasteSkip {
  lotId: string;
  // Widened on purpose — the backend may add reasons (e.g. `inactive_item` is pending a
  // product decision). Never switch exhaustively on this; always have a fallback label.
  reason: ExpiredWasteSkipReason | (string & {});
}

export interface ExpiredWasteResult {
  wasted: string[];
  skipped: ExpiredWasteSkip[];
}

// Max lot_ids the endpoint accepts in one call — beyond it the request is a 422.
export const EXPIRED_WASTE_MAX = 200;

export function useExpiredWaste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lotIds: string[]): Promise<ExpiredWasteResult> => {
      const r = await api.post<ExpiredWasteResultRead>(
        '/api/v1/inventory/expired/waste',
        { lot_ids: lotIds },
      );
      return {
        wasted: r.wasted ?? [],
        skipped: (r.skipped ?? []).map(s => ({ lotId: s.lot_id, reason: s.reason })),
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-expired'] });     // the list we just acted on
      qc.invalidateQueries({ queryKey: ['inventory'] });             // stock_on_hand
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });   // the new EXPIRED rows
      qc.invalidateQueries({ queryKey: ['inventory-lots'] });        // qty_remaining in LotsModal
    },
  });
}

export function useSupplierHistory(itemId: string | null) {
  return useQuery<SupplierHistoryItem[]>({
    queryKey: ['inventory-supplier-history', itemId],
    queryFn: () => api.get<SupplierHistoryItem[]>(`/api/v1/inventory/${itemId}/supplier-history`),
    enabled: !!itemId,
  });
}

// ── Packs (ways of buying one ingredient) ─────────────────────────────────────
// Writes are MANAGER/OWNER only (backend enforces; the screen gates too).
// Labels are unique per ingredient *including deactivated packs* — re-creating a
// deleted label is a 409 CONFLICT, so the UI offers "reactivate" instead.

/** `includeInactive` drops the is_active filter so deactivated packs are listed too. */
export function useItemPacks(itemId: string | null, includeInactive = false) {
  return useQuery<Pack[]>({
    queryKey: ['inventory-packs', itemId, includeInactive],
    queryFn: async () => {
      const qs = includeInactive ? '' : '?is_active=true';
      const data = await api.get<PackRead[]>(`/api/v1/inventory/${itemId}/packs${qs}`);
      return data.map(mapPack);
    },
    enabled: !!itemId,
  });
}

// Packs live on InventoryItemRead too, so every pack write refreshes ['inventory'].
function invalidatePacks(qc: ReturnType<typeof useQueryClient>, itemId: string) {
  qc.invalidateQueries({ queryKey: ['inventory'] });
  qc.invalidateQueries({ queryKey: ['inventory-packs', itemId] });
}

export function useCreatePack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, pack }: { itemId: string; pack: PackCreatePayload }) => {
      const p = await api.post<PackRead>(`/api/v1/inventory/${itemId}/packs`, pack);
      return mapPack(p);
    },
    onSuccess: (_data, { itemId }) => invalidatePacks(qc, itemId),
  });
}

export interface PackUpdatePayload {
  label?: string;
  pack_size?: string;   // 409 PACK_HAS_LOTS once any lot has been received on this pack
  last_price?: string;
  is_default?: boolean; // only ever send `true` — see PACK_DEFAULT_UNSET_NOT_ALLOWED
  is_active?: boolean;
}

export function useUpdatePack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, packId, patch }: { itemId: string; packId: string; patch: PackUpdatePayload }) => {
      const p = await api.patch<PackRead>(`/api/v1/inventory/${itemId}/packs/${packId}`, patch);
      return mapPack(p);
    },
    onSuccess: (_data, { itemId }) => invalidatePacks(qc, itemId),
  });
}

/** Soft delete (is_active=false). Refused on the default pack while others are active. */
export function useDeactivatePack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, packId }: { itemId: string; packId: string }) =>
      api.delete<void>(`/api/v1/inventory/${itemId}/packs/${packId}`),
    onSuccess: (_data, { itemId }) => invalidatePacks(qc, itemId),
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

// Pin the lot an ingredient is costed against, or `null` to return to FIFO. The pin
// clears itself when the lot empties. Writes no StockMovement — nothing moved.
// It is a property of the INGREDIENT: every product using it re-costs, hence the
// blanket ['product-detail'] invalidation.
export function useSetInUseLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, lotId }: { itemId: string; lotId: string | null }) =>
      api.put<InventoryItemRead>(`/api/v1/inventory/${itemId}/in-use-lot`, { lot_id: lotId }),
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-lots', itemId] });
      qc.invalidateQueries({ queryKey: ['product-detail'] });
    },
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
  pack_id: string;
  qty_packs: string;
  pack_price: string;   // price of ONE pack — the modal divides the total it collects
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
      qc.invalidateQueries({ queryKey: ['inventory-lots'] });   // draft lots show in LotsModal
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
      qc.invalidateQueries({ queryKey: ['inventory-lots'] });
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
      // Confirming creates the lots (with expiry) and moves qty_remaining.
      qc.invalidateQueries({ queryKey: ['inventory-lots'] });
      qc.invalidateQueries({ queryKey: ['inventory-expired'] });
    },
  });
}
