import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface ProtocolTask {
  id: string;
  protocol_id: string;
  title: string;
  sort_order: number;
}

export interface Protocol {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  frequency: 'DAILY' | 'OPENING' | 'CLOSING' | 'WEEKLY';
  is_active: boolean;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  tasks: ProtocolTask[];
}

export interface ProtocolLog {
  id: string;
  protocol_id: string;
  store_id: string;
  log_date: string;
  completed_task_ids: string[];
  completed_by_id: string;
  created_at: string;
}

const PROTOCOLS_KEY = ['protocols'] as const;
const LOGS_KEY = ['protocol-logs-today'] as const;

export function useProtocols() {
  return useQuery<Protocol[]>({
    queryKey: PROTOCOLS_KEY,
    queryFn: () => api.get<Protocol[]>('/api/v1/protocols'),
  });
}

export function useCreateProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      description?: string;
      frequency: string;
      tasks: { title: string; sort_order: number }[];
    }) => api.post<Protocol>('/api/v1/protocols', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROTOCOLS_KEY }),
  });
}

export function useTodayProtocolLogs() {
  return useQuery<ProtocolLog[]>({
    queryKey: LOGS_KEY,
    queryFn: () => api.get<ProtocolLog[]>('/api/v1/protocols/logs/today'),
  });
}

export function useLogProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { protocol_id: string; log_date: string; completed_task_ids: string[] }) =>
      api.post<ProtocolLog>('/api/v1/protocols/log', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: LOGS_KEY }),
  });
}
