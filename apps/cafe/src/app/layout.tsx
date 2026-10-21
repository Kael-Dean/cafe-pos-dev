import type { Metadata, Viewport } from "next";
import { Anuphan } from "next/font/google";
import "@pos/core/styles/globals.css";
import { RootDocument } from "@pos/core/shell/root-document";
import { createMetadata, rootViewport } from "@pos/core/shell/metadata";
import { brand } from "@/edition/brand";

// Anuphan (Cadson Demak) — self-hosted via next/font, exposed as --font-anuphan
// so globals.css can slot it in front of the sans stack. Variable font, so no
// explicit weight; Thai + Latin subsets cover the whole UI. next/font must be
// called from the app itself, so this stays here rather than in @pos/core.
const anuphan = Anuphan({
  subsets: ["latin", "thai"],
  display: "swap",
  variable: "--font-anuphan",
});

export const metadata: Metadata = createMetadata(brand);
export const viewport: Viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument fontClassName={anuphan.variable}>{children}</RootDocument>;
}
