import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export type UserRole = 'OWNER' | 'MANAGER' | 'BARISTA' | 'BAKER';

export interface CurrentUser {
  id: string;
  name: string;
  role: UserRole;
  store_id: string | null;
  store_name: string | null;
  tenant_id: string;
}

export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ['current-user'],
    queryFn: () => api.get<CurrentUser>('/api/v1/auth/me'),
    staleTime: Infinity,
    retry: false,
  });
}

export function isAdmin(role: UserRole | undefined) {
  return role === 'OWNER' || role === 'MANAGER';
}
