"use client";
import Link from "next/link";
import { useState } from "react";
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

/** What to do when the wallet is not yet eligible: copy the address and send it to the operator. */
export function EligibilityHelp({ wallet }: { wallet: string }) {
  const h = useI18n().t.help;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="helpbox" data-testid="eligibility-help">
      <span>{h.eligibleHow}</span>
      <div className="row-actions">
        <button type="button" className="btn ghost sm" onClick={copy}>{copied ? h.copied : h.copyWallet}</button>
        <ContactLinks />
        <Link href="/guide#eligibility">{h.guideLink}</Link>
      </div>
    </div>
  );
}
