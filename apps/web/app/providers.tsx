"use client";
import { Web3Providers } from "@roboshare/ui";
import { useEffect, type ReactNode } from "react";
import { LocaleFont } from "@/components/Chrome";
import { walletEnv } from "@/env";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/locales";
import { captureReferrer } from "@/lib/referral";

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => captureReferrer(window.location.search), []);
  return (
    <I18nProvider initial={locale}>
      <LocaleFont />
      <Web3Providers env={walletEnv}>{children}</Web3Providers>
    </I18nProvider>
  );
}
