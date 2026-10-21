import { headers } from 'next/headers';
import { Providers } from './providers';

/**
 * <html>/<body> for every edition's root layout (server component). The app
 * layout owns only what Next requires to live in the app: next/font, the global
 * CSS import and the `metadata` / `viewport` exports.
 */
export async function RootDocument({ fontClassName, children }: { fontClassName: string; children: React.ReactNode }) {
  // Per-request CSP nonce minted in lib/server/proxy.ts. Reading headers() also keeps
  // the route dynamic, which nonces require (a static page has no request).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // suppressHydrationWarning: the no-flash script below stamps data-theme on
    // <html> before React hydrates, so the attribute never matches server HTML.
    <html lang="th" className={`h-full ${fontClassName}`} suppressHydrationWarning>
      <head>
        {/* No-flash theme: runs before first paint, so the page never renders in
            the wrong theme. Reads the saved preference, falling back to the OS
            setting, and stamps <html data-theme>. Kept tiny and self-contained;
            ThemeProvider later just syncs React state to whatever this set. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('kafe-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
