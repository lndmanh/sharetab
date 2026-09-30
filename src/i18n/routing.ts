import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'vi'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const rtlLocales: Locale[] = [];

export const languageConfig: Record<Locale, { flag: string; name: string }> = {
  en: { flag: '\u{1F1FA}\u{1F1F8}', name: 'English' },
  vi: { flag: '\u{1F1FB}\u{1F1F3}', name: 'Tiếng Việt' },
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'never',
  localeCookie: {
    maxAge: 60 * 60 * 24 * 365,
  },
});
