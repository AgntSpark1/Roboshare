"use client";
import { UiStringsProvider } from "@roboshare/ui";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

interface I18n {
  locale: Locale;
  t: Messages;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<I18n>({ locale: DEFAULT_LOCALE, t: MESSAGES[DEFAULT_LOCALE], setLocale: () => undefined });

/** The server resolves the first locale (cookie, else Accept-Language); switching later needs no reload. */
export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    setState(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    document.title = MESSAGES[l].meta.title;
  }, []);
  const value = useMemo(() => ({ locale, t: MESSAGES[locale], setLocale }), [locale, setLocale]);
  return (
    <Ctx.Provider value={value}>
      <UiStringsProvider strings={value.t.ui}>{children}</UiStringsProvider>
    </Ctx.Provider>
  );
}

export function useI18n(): I18n {
  return useContext(Ctx);
}
