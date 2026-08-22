'use client';

import { useQuery } from '@tanstack/react-query';
import { api, ADMIN_LOGIN_PATH } from '@/lib/admin-api';
import { getAdminToken } from '@/lib/admin-token';

export interface AdminMeResponse {
  id: string;
  email: string;
  name: string;
  last_login_at: string | null;
}

interface AdminTokenResponse {
  access_token: string;
  token_type: string;
}

/**
 * Exchange email + password for an admin access token.
 *
 * Not a React Query mutation: the login screen owns this one call and needs the
 * raw error status (401 vs 429) to pick its message.
 */
export async function loginAdmin(email: string, password: string): Promise<string> {
  const res = await api.post<AdminTokenResponse>(ADMIN_LOGIN_PATH, { email, password });
  return res.access_token;
}

export const ADMIN_ME_KEY = ['admin', 'me'] as const;

/**
 * The signed-in admin. Used on boot to validate a stored token: a 401 here
 * clears the token (see admin-api) and the portal layout bounces to /login.
 */
export function useAdminMe() {
  return useQuery<AdminMeResponse>({
    queryKey: ADMIN_ME_KEY,
    queryFn: () => api.get<AdminMeResponse>('/api/v1/admin/auth/me'),
    // The token lives ~8h and the profile never changes inside a session.
    staleTime: Infinity,
    // A 401 is an answer, not a blip — retrying just delays the redirect.
    retry: false,
    enabled: typeof window !== 'undefined' && getAdminToken() !== null,
  });
}
