import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// GET /api/v1/reports/sales?granularity=product — buckets labelled by product name.
interface SalesBucketRead {
  bucket: string; // product name when granularity=product
  order_count: number;
  revenue: string | number;
}
interface SalesReportRead {
  buckets: SalesBucketRead[];
  total_revenue: string | number;
  total_orders: number;
}

const TOP_N = 12;          // mark the top ~12 sellers as "hot"
const HOUR_MS = 3_600_000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO bounds for the last 30 calendar days (today − 29 … today), local time. */
function last30Bounds(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29, 0, 0, 0, 0);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Names of the top ~12 best-selling products over the last 30 days (by revenue),
 * as a Set for O(1) membership checks against MenuItem.name. Product names are
 * unique per store here, so name-matching is safe. COMPONENTs are non-sellable
 * and never appear in sales.
 */
export function useBestSellerNames() {
  const dateStr = ymd(new Date()); // keyed by day so it rolls over daily
  return useQuery<Set<string>>({
    queryKey: ['best-sellers', dateStr],
    staleTime: HOUR_MS,
    gcTime: HOUR_MS,
    retry: 1,
    queryFn: async () => {
      const b = last30Bounds();
      const rep = await api.get<SalesReportRead>(
        `/api/v1/reports/sales?from=${encodeURIComponent(b.from)}&to=${encodeURIComponent(b.to)}&granularity=product`,
      );
      const names = rep.buckets
        .slice()
        .sort((x, y) => Number(y.revenue) - Number(x.revenue))
        .slice(0, TOP_N)
        .map(bk => bk.bucket);
      return new Set(names);
    },
  });
}
