import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (snake_case) ───────────────────────────────────────────────
interface StockTakePreviewItemRaw {
  inventory_item_id: string;
  name: string;
  unit: string;
  consumed_in_period: string;
  system_quantity: string;
}

interface StockTakePreviewRaw {
  period_start: string;
  period_end: string;
  items: StockTakePreviewItemRaw[];
}

interface StockTakeAdjustResultRaw {
  inventory_item_id: string;
  name: string;
  unit: string;
  system_quantity: string;
  actual_quantity: string;
  variance: string;
}

interface StockTakeHistoryItemRaw {
  name: string;
  unit: string;
  system_quantity: string;
  actual_quantity: string;
  variance: string;
}

interface StockTakeEventRaw {
  conducted_at: string;
  conducted_by: string;
  item_count: number;
  items: StockTakeHistoryItemRaw[];
}

// ── Frontend shapes (camelCase) ───────────────────────────────────────────────
export interface StockTakePreviewItem {
  inventoryItemId: string;
  name: string;
  unit: string;
  consumedInPeriod: number;
  systemQuantity: number;
}

export interface StockTakePreview {
  periodStart: string;
  periodEnd: string;
  items: StockTakePreviewItem[];
}

export interface StockTakeAdjustResult {
  inventoryItemId: string;
  name: string;
  unit: string;
  systemQuantity: number;
  actualQuantity: number;
  variance: number;
}

export interface StockTakeHistoryItem {
  name: string;
  unit: string;
  systemQuantity: number;
  actualQuantity: number;
  variance: number;
}

export interface StockTakeEvent {
  conductedAt: string;
  conductedBy: string;
  itemCount: number;
  items: StockTakeHistoryItem[];
}

export interface StockTakeSubmitPayload {
  items: { inventory_item_id: string; actual_quantity: string }[];
  notes?: string;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
function mapPreviewItem(i: StockTakePreviewItemRaw): StockTakePreviewItem {
  return {
    inventoryItemId: i.inventory_item_id,
    name: i.name,
    unit: i.unit,
    consumedInPeriod: Number(i.consumed_in_period),
    systemQuantity: Number(i.system_quantity),
  };
}

function mapPreview(r: StockTakePreviewRaw): StockTakePreview {
  return {
    periodStart: r.period_start,
    periodEnd: r.period_end,
    items: r.items.map(mapPreviewItem),
  };
}

function mapAdjustResult(r: StockTakeAdjustResultRaw): StockTakeAdjustResult {
  return {
    inventoryItemId: r.inventory_item_id,
    name: r.name,
    unit: r.unit,
    systemQuantity: Number(r.system_quantity),
    actualQuantity: Number(r.actual_quantity),
    variance: Number(r.variance),
  };
}

function mapHistoryItem(i: StockTakeHistoryItemRaw): StockTakeHistoryItem {
  return {
    name: i.name,
    unit: i.unit,
    systemQuantity: Number(i.system_quantity),
    actualQuantity: Number(i.actual_quantity),
    variance: Number(i.variance),
  };
}

function mapEvent(e: StockTakeEventRaw): StockTakeEvent {
  return {
    conductedAt: e.conducted_at,
    conductedBy: e.conducted_by,
    itemCount: e.item_count,
    items: e.items.map(mapHistoryItem),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useStockTakePreview() {
  return useQuery<StockTakePreview>({
    queryKey: ['stock-take-preview'],
    queryFn: async () => {
      const data = await api.get<StockTakePreviewRaw>('/api/v1/stock-takes/preview');
      return mapPreview(data);
    },
    staleTime: 0,
    gcTime: 0,
  });
}

export function useSubmitStockTake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StockTakeSubmitPayload) =>
      api.post<StockTakeAdjustResultRaw[]>('/api/v1/stock-takes', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-take-preview'] });
      qc.invalidateQueries({ queryKey: ['stock-take-history'] });
    },
  });
}

export function useStockTakeHistory() {
  return useQuery<StockTakeEvent[]>({
    queryKey: ['stock-take-history'],
    queryFn: async () => {
      const data = await api.get<StockTakeEventRaw[]>('/api/v1/stock-takes/history');
      return data.map(mapEvent);
    },
  });
}
