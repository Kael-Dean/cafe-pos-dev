import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// GET /api/v1/reports/salesperson-kpi?from=&to= (manager/owner only).
// Chain Order → Customer → Salesperson; only revenue statuses count (VOID excluded,
// same definition as the sales report). Assigned members who didn't buy are still
// returned with zeros (the KPI denominator); unassigned members are excluded.
// Decimals arrive as strings (FastAPI serializes Numeric → string) → Number() them.
// See caf-pos-repo-main/api/app/api/v1/reports.py (reports_salesperson_kpi).
interface KpiItemRead {
  product_name: string;
  quantity: number;
  value: string | number;
}
interface KpiMemberRead {
  customer_id: string;
  name: string;
  phone: string | null;
  order_count: number;
  total_items: number;
  total_value: string | number;
  items: KpiItemRead[];
}
interface KpiSalespersonRead {
  sales_id: string;
  sales_name: string;
  member_count: number;
  buying_member_count: number;
  total_items: number;
  total_value: string | number;
  members: KpiMemberRead[];
}
interface SalespersonKpiReportRead {
  salespeople: KpiSalespersonRead[]; // from_/to are echoed back but unused here
}

// ── Frontend shapes (numbers, camelCase) ────────────────────────────────────────
export interface KpiItem {
  productName: string;
  quantity: number;
  value: number;
}
export interface KpiMember {
  customerId: string;
  name: string;
  phone: string | null;
  orderCount: number;
  totalItems: number;
  totalValue: number;
  items: KpiItem[];
}
export interface SalespersonKpi {
  salesId: string;
  salesName: string;
  memberCount: number;
  buyingMemberCount: number;
  totalItems: number;
  totalValue: number;
  members: KpiMember[];
}

// Build ISO bounds from local calendar days — mirrors rangeBounds() in
// use-sales-report.ts so KPI totals line up with the sales report's timezone.
function rangeBounds(fromStr: string, toStr: string): { from: string; to: string } {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Salesperson KPI for a local date range, keyed by `sales_id`. The sales screen
 * merges this onto the active-salespeople list, so salespeople with no assigned
 * members (absent from the report) simply fall back to zeros.
 */
export function useSalespersonKpi(from: string, to: string) {
  return useQuery<Record<string, SalespersonKpi>>({
    queryKey: ['salesperson-kpi', from, to],
    enabled: from <= to,
    queryFn: async () => {
      const b = rangeBounds(from, to);
      const rep = await api.get<SalespersonKpiReportRead>(
        `/api/v1/reports/salesperson-kpi?from=${encodeURIComponent(b.from)}&to=${encodeURIComponent(b.to)}`,
      );
      const map: Record<string, SalespersonKpi> = {};
      for (const sp of rep.salespeople ?? []) {
        map[sp.sales_id] = {
          salesId: sp.sales_id,
          salesName: sp.sales_name,
          memberCount: sp.member_count,
          buyingMemberCount: sp.buying_member_count,
          totalItems: sp.total_items,
          totalValue: Number(sp.total_value),
          members: (sp.members ?? []).map((m) => ({
            customerId: m.customer_id,
            name: m.name,
            phone: m.phone,
            orderCount: m.order_count,
            totalItems: m.total_items,
            totalValue: Number(m.total_value),
            items: (m.items ?? []).map((it) => ({
              productName: it.product_name,
              quantity: it.quantity,
              value: Number(it.value),
            })),
          })),
        };
      }
      return map;
    },
  });
}
