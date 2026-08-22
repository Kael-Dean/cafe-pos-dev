import type { Metadata, Viewport } from "next";
import { Anuphan } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const anuphan = Anuphan({
  subsets: ["latin", "thai"],
  display: "swap",
  variable: "--font-anuphan",
});

export const metadata: Metadata = {
  title: "FRD Control Plane",
  description: "ระบบจัดการลูกค้า แพ็กเกจ และสาขา ของ FRD",
  // Internal tool — keep it out of every index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the saved theme to <html> BEFORE first paint, so a dark-mode user
 * never sees a light flash. ThemeProvider reads back whatever this decided.
 */
const NO_FLASH_THEME = `
(function () {
  try {
    var t = localStorage.getItem('frd-admin-theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={anuphan.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
