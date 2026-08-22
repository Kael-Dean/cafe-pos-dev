'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionExpiredError } from '@/lib/admin-api';
import { ToastProvider } from '@/components/ui/toast';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Volumes here are tiny and nothing changes except through this
            // portal, so a short freshness window is plenty and a refetch on
            // every navigation is cheap.
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // An expired token will not un-expire; retrying only delays the
              // bounce to /login.
              if (error instanceof SessionExpiredError) return false;
              return failureCount < 1;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
