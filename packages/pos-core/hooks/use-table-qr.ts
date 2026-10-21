import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';

/**
 * Table QR stickers (handoff Part B). OWNER / MANAGER only (403 for staff).
 * GET mints the code on first call and then always returns the same one; reissue
 * replaces it (the old sticker answers 404 on join, seated guests keep working).
 * `url` / `qr_png_base64` are null until FRD sets the store's guest site URL.
 */

interface TableQrRead {
  table_id: string;
  table_name: string;
  code: string;
  url: string | null;
  qr_png_base64: string | null;
}

export interface TableQr {
  tableId: string;
  tableName: string;
  code: string;
  url: string | null;
  pngBase64: string | null;
}

const mapQr = (r: TableQrRead): TableQr => ({
  tableId: r.table_id,
  tableName: r.table_name,
  code: r.code,
  url: r.url,
  pngBase64: r.qr_png_base64,
});

const qrKey = (tableId: string) => ['table-qr', tableId] as const;
const fetchQr = async (tableId: string) => mapQr(await api.get<TableQrRead>(`/api/v1/floor/tables/${tableId}/qr`));

export function useTableQr(tableId: string | null) {
  return useQuery<TableQr>({
    queryKey: qrKey(tableId ?? ''),
    queryFn: () => fetchQr(tableId!),
    enabled: !!tableId,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** One query per table, for the print sheet. */
export function useTableQrs(tableIds: readonly string[], enabled: boolean) {
  return useQueries({
    queries: tableIds.map((id) => ({
      queryKey: qrKey(id),
      queryFn: () => fetchQr(id),
      enabled,
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
}

export function useReissueTableQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tableId: string) => mapQr(await api.post<TableQrRead>(`/api/v1/floor/tables/${tableId}/qr/reissue`, {})),
    onSuccess: (qr) => { qc.setQueryData(qrKey(qr.tableId), qr); },
  });
}

/** The PNG as a data URL (the CSP allows `img-src data:`). */
export const qrDataUrl = (b64: string) => `data:image/png;base64,${b64}`;
