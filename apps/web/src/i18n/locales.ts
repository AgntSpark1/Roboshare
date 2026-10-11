/** Languages of the investor site. The first one is the default and the source of every translation. */
export const LOCALES = [
  // font: extra Google Fonts family for this script (Noto Sans SC is always loaded); see web.css for the stacks.
  { code: "zh-CN", label: "简体中文", short: "简", font: null },
  { code: "zh-TW", label: "繁體中文", short: "繁", font: "Noto+Sans+TC" },
  { code: "en", label: "English", short: "EN", font: "Noto+Sans" },
  { code: "ja", label: "日本語", short: "日", font: "Noto+Sans+JP" },
  { code: "ko", label: "한국어", short: "한", font: "Noto+Sans+KR" },
  { code: "vi", label: "Tiếng Việt", short: "VI", font: "Noto+Sans" },
  { code: "th", label: "ภาษาไทย", short: "TH", font: "Noto+Sans+Thai" },
  { code: "id", label: "Bahasa Indonesia", short: "ID", font: "Noto+Sans" },
  { code: "es", label: "Español", short: "ES", font: "Noto+Sans" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export const DEFAULT_LOCALE: Locale = "zh-CN";
/** Remembers the visitor's choice; read on the server so the first paint is already in their language. */
export const LOCALE_COOKIE = "rs_lang";

export function isLocale(v: string | null | undefined): v is Locale {
  return LOCALES.some((l) => l.code === v);
}

/** Best match for one browser language tag such as "zh-Hant-HK", "en-US" or "pt-BR" (no match: null). */
function matchTag(tag: string): Locale | null {
  const t = tag.trim().toLowerCase();
  if (!t) return null;
  const [lang, ...rest] = t.split("-");
  if (lang === "zh") {
    // Traditional script, or a region that writes it, gets 繁體; everything else (zh, zh-cn, zh-sg, zh-hans) 简体.
    return rest.some((p) => p === "hant" || p === "tw" || p === "hk" || p === "mo") ? "zh-TW" : "zh-CN";
  }
  if (lang === "in") return "id"; // legacy code some Android builds still send
  return LOCALES.find((l) => l.code === lang)?.code ?? null;
}

/** Picks a locale from an Accept-Language header (or navigator.languages joined by commas), honouring q-values. */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  const tags = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag ?? "", q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of tags) {
    const m = matchTag(tag);
    if (m) return m;
  }
  return DEFAULT_LOCALE;
}
