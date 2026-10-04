import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Anuphan } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Anuphan (Cadson Demak) — self-hosted via next/font, exposed as --font-anuphan
// so globals.css can slot it in front of the sans stack. Variable font, so no
// explicit weight; Thai + Latin subsets cover the whole UI.
const anuphan = Anuphan({
  subsets: ["latin", "thai"],
  display: "swap",
  variable: "--font-anuphan",
});

export const metadata: Metadata = {
  title: "Kafé OS",
  description: "Cafe POS System",
  applicationName: "Kafé OS",
  // Installed-app behaviour on iOS/iPadOS (Add to Home Screen). The status bar
  // stays 'default' (opaque, content starts below it): the shell does not pad for
  // env(safe-area-inset-top), so a translucent bar would overlap the top row.
  appleWebApp: {
    capable: true,
    title: "Kafé OS",
    statusBarStyle: "default",
  },
  // favicon.ico is picked up from src/app by convention; these add the crisp
  // PNG for browser UI and the opaque 180px tile iOS uses on the home screen.
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Order numbers / PINs must not turn into tap-to-call links on iOS.
  formatDetection: { telephone: false },
  // Next emits the standard `mobile-web-app-capable`; older iPads (common as
  // counter tablets) only honour Apple's original name for standalone launch.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  // Browser / installed-app chrome colour = --color-bg per theme. These are the
  // OS-preference defaults; components/pwa re-syncs them to the in-app theme
  // (<html data-theme>) when the saved choice differs from the OS setting.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F3EC' },
    { media: '(prefers-color-scheme: dark)', color: '#1A140E' },
  ],
  width: 'device-width',
  initialScale: 1,
  // No maximumScale: pinch-zoom must stay available (WCAG 1.4.4). Inputs are 16px on
  // phones, so iOS focus-zoom is already avoided without locking the scale.
  // Extend under the notch / home indicator so env(safe-area-inset-*) resolves to
  // real values (the bottom tab bar and modal sheets rely on it). Without this the
  // insets are 0 on notched iPhones/iPads and fixed UI sits under the home bar.
  viewportFit: 'cover',
  // Resize the layout when the soft keyboard opens (Chrome/Android tablets).
  // iOS handles this via the VisualViewport hook (use-keyboard-inset).
  interactiveWidget: 'resizes-content',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce minted in src/proxy.ts. Reading headers() also keeps
  // the route dynamic, which nonces require (a static page has no request).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: the no-flash script below stamps data-theme on
    // <html> before React hydrates, so the attribute never matches server HTML.
    <html lang="th" className={`h-full ${anuphan.variable}`} suppressHydrationWarning>
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
