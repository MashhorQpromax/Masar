import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "مسار",
  description: "منصة دراسة التمويل وإدارة صفقات السداد وإعادة التمويل",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#eef0f3", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
