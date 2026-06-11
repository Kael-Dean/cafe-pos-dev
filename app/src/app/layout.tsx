import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Kafé OS",
  description: "Cafe POS System",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Resize the layout when the soft keyboard opens (Chrome/Android tablets).
  // iOS handles this via the VisualViewport hook (use-keyboard-inset).
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className="h-full">
      <head>
        {/* No-flash theme: runs before first paint, so the page never renders in
            the wrong theme. Reads the saved preference, falling back to the OS
            setting, and stamps <html data-theme>. Kept tiny and self-contained;
            ThemeProvider later just syncs React state to whatever this set. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('kafe-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full">
        <Script src="/epos-2.27.0.js" strategy="afterInteractive" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
