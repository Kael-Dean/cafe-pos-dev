'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';
import { LanguageProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';
import { SystemBar } from '@/components/pwa/system-bar';

export function Providers({ children }: { children: React.ReactNode }) {
  // Keep centered modals / focused inputs above the on-screen keyboard on
  // tablets & iPads (the keyboard otherwise covers fields, esp. in landscape).
  useKeyboardInset();

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          {/* Offline banner + service-worker registration / update prompt. Lives
              here (not in page.tsx) so it also covers the login screen. */}
          <SystemBar />
          {children}
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
