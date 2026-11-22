import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "مسار",
  description: "إدارة ملفات عملاء التمويل، دراسة الأهلية، ومطابقة جهات التمويل",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {["plex-arabic-400", "plex-arabic-600", "alexandria-arabic"].map((f) => <link key={f} rel="preload" href={`/fonts/${f}.woff2`} as="font" type="font/woff2" crossOrigin="anonymous" />)}
      </head>
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
