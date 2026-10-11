import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, pickLocale, type Locale } from "./locales";

/** The visitor's saved choice, else the best match for their browser languages. */
export async function requestLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return pickLocale((await headers()).get("accept-language"));
}
