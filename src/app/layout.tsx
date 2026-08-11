import type { Metadata } from "next";
import { Commissioner, IBM_Plex_Mono, Onest } from "next/font/google";
import { metadataCopy } from "@/content/landing/metadata";
import "./globals.css";

// Onest — тело текста; Commissioner — заголовки (выразительный гуманистический гротеск);
// IBM Plex Mono — цифры/метрики (спокойный инструментальный вид). Кириллица везде.
const onest = Onest({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});
const commissioner = Commissioner({
  variable: "--font-display",
  weight: "variable",
  subsets: ["latin", "cyrillic"],
  axes: ["FLAR"],
  display: "swap",
});
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: metadataCopy.title,
  description: metadataCopy.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${onest.variable} ${commissioner.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
