import "./globals.css";

import type { Metadata } from "next";
import {
  Caveat,
  DM_Sans,
  JetBrains_Mono,
  Playfair_Display,
  Source_Serif_4,
} from "next/font/google";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Variable fonts: one file each covers every weight, which text shapes on the board use.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tack",
  description: "Real-time collaborative whiteboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} ${caveat.variable} ${sourceSerif.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
