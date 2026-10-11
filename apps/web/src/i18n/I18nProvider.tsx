"use client";
import { UiStringsProvider } from "@roboshare/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, matchLocale, type Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

interface I18n {
  locale: Locale;
  t: Messages;
  /** True until the visitor picks a language; the page then follows the device's language. */
  auto: boolean;
  setLocale: (l: Locale) => void;
  /** Forgets the visitor's choice and goes back to the device's language. */
  setAuto: () => void;
}

const Ctx = createContext<I18n>({ locale: DEFAULT_LOCALE, t: MESSAGES[DEFAULT_LOCALE], auto: true, setLocale: () => undefined, setAuto: () => undefined });

function savedLocale(): Locale | null {
  const v = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`))?.[1];
  return isLocale(v) ? v : null;
}

/**
 * The device's languages as the browser reports them. Wallet in-app browsers often send the wallet's own
 * language (or a fixed one) in Accept-Language, while navigator.languages and Intl still follow the phone.
 */
export function deviceLocale(): Locale | null {
  const tags = [...(navigator.languages ?? []), navigator.language, Intl.DateTimeFormat().resolvedOptions().locale];
  return matchLocale(tags.filter(Boolean).join(","));
}

/** The server renders the first locale (cookie, else Accept-Language); without a saved choice the client then follows the device. */
export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setState] = useState<Locale>(initial);
  const [auto, setAutoState] = useState(true);
  const show = useCallback((l: Locale) => {
    setState(l);
    document.documentElement.lang = l;
    document.title = MESSAGES[l].meta.title;
  }, []);
  useEffect(() => {
    if (savedLocale()) {
      setAutoState(false);
      return;
    }
    const d = deviceLocale();
    if (d && d !== initial) show(d);
  }, [initial, show]);
  const setLocale = useCallback(
    (l: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
      setAutoState(false);
      show(l);
    },
    [show],
  );
  const setAuto = useCallback(() => {
    document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    setAutoState(true);
    show(deviceLocale() ?? DEFAULT_LOCALE);
  }, [show]);
  const value = useMemo(() => ({ locale, t: MESSAGES[locale], auto, setLocale, setAuto }), [locale, auto, setLocale, setAuto]);
  return (
    <Ctx.Provider value={value}>
      <UiStringsProvider strings={value.t.ui}>{children}</UiStringsProvider>
    </Ctx.Provider>
  );
}

export function useI18n(): I18n {
  return useContext(Ctx);
}
