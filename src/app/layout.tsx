import type { Metadata } from "next";
import { Commissioner, Onest } from "next/font/google";
import { CookieConsent } from "@/components/CookieConsent";
import { metadataCopy } from "@/content/landing/metadata";
import "./globals.css";

// Onest — тело текста; Commissioner — заголовки и все продуктовые метрики.
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
      className={`${onest.variable} ${commissioner.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
