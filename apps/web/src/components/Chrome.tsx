"use client";
import Link from "next/link";
import { isTestChain } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALES } from "@/i18n/locales";

export function SkipLink() {
  const { t } = useI18n();
  return <a className="skip" href="#main">{t.layout.skip}</a>;
}

export function TestRibbon() {
  const { t } = useI18n();
  if (!isTestChain) return null;
  return (
    <div className="ribbon" role="note">
      <b>{t.layout.testBanner}</b> · {t.layout.testBannerText}
    </div>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer>
      <div className="wrap">
        <span>{t.layout.footerTag}</span>
        <span>
          {t.layout.footerRisk}<Link href="/risk">{t.layout.investorNotes}</Link>
        </span>
      </div>
    </footer>
  );
}

/** Font for the current script; React hoists the stylesheet into <head> and swaps it when the language changes. */
export function LocaleFont() {
  const { locale } = useI18n();
  const font = LOCALES.find((l) => l.code === locale)?.font;
  if (!font) return null;
  return <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${font}:wght@400;500;700;900&display=swap`} precedence="default" />;
}
