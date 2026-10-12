"use client";
import { support } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";

/** Telegram / email links when configured; nothing otherwise. */
export function ContactLinks() {
  const h = useI18n().t.help;
  if (!support.telegram && !support.email) return null;
  return (
    <span className="contact-links">
      {support.telegram && <a href={support.telegram} target="_blank" rel="noreferrer">{h.telegram}</a>}
      {support.email && <a href={`mailto:${support.email}`}>{support.email}</a>}
    </span>
  );
}

