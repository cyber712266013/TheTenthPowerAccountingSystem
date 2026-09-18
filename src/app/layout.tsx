import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'نظام الحسابات | تحليل الفواتير والمستندات المالية',
  description: 'نظام ذكي لتحليل الفواتير والمستندات المالية وتحويلها إلى حركات مالية منظمة',
  keywords: 'فواتير, حسابات, كشف حساب, محاسبة, ذكاء اصطناعي',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
