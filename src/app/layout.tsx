import type { Metadata } from "next";
import { Onest, Unbounded, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Onest — тело текста; Unbounded — заголовки (гротеск с характером);
// JetBrains Mono — цифры/метрики (инструментальный вид). Кириллица везде.
const onest = Onest({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});
const unbounded = Unbounded({
  variable: "--font-display",
  weight: ["600", "700"],
  subsets: ["latin", "cyrillic"],
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Smailee — тёплые лиды из холодной базы без найма менеджера",
  description:
    "AI-сотрудник, который пишет персональные письма, сам ведёт диалог с вашей холодной базой и приводит квалифицированных лидов. Без найма маркетолога.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${onest.variable} ${unbounded.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
