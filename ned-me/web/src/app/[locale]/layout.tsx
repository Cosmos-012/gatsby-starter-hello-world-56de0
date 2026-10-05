import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import '../globals.css';
import { dirOf, isLocale, LOCALES, messagesFor, translate } from '@/lib/i18n';

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = messagesFor(locale);
  return { title: translate(m, 'app.title'), description: translate(m, 'app.question') };
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
