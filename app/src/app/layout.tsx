import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kafé OS",
  description: "Cafe POS System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
