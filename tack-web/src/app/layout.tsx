import "./globals.css";

import { ThemeProvider } from "next-themes";
import type { Metadata } from "next";
import {
  Caveat,
  DM_Sans,
  JetBrains_Mono,
  Playfair_Display,
  Source_Serif_4,
} from "next/font/google";

import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";

// Italics are loaded too: markdown text uses them, and the page turns off faked italics.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Variable fonts: one file each covers every weight, which text shapes on the board use.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Tack",
  description: "Real-time collaborative whiteboard",
};

const className = `${dmSans.variable} ${jetbrainsMono.variable} ${caveat.variable} ${sourceSerif.variable} ${playfair.variable}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${className}`}>
      <body className="flex min-h-full flex-col">
        <QueryProvider>
          <ThemeProvider attribute="class" defaultTheme="light">
            {children}
          </ThemeProvider>
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
