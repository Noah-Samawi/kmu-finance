"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, translator, type Lang } from "@/lib/i18n";
import { cx } from "./ui";

const LangContext = createContext<Lang>("de");

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useT() {
  const lang = useContext(LangContext);
  return useMemo(() => translator(lang), [lang]);
}

/** Umschalter Deutsch / العربية – speichert die Wahl ein Jahr im Cookie. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const lang = useContext(LangContext);
  const router = useRouter();
  const pick = (l: Lang) => {
    if (l === lang) return;
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  const opt = (l: Lang, label: string) => (
    <button
      type="button"
      lang={l}
      aria-pressed={lang === l}
      onClick={() => pick(l)}
      className={cx("rounded-md px-2 py-1 text-xs font-semibold", lang === l ? "bg-ledger text-white" : "text-muted hover:text-ink")}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={translator(lang)("lang.label")} className={cx("inline-flex gap-0.5 rounded-lg border border-line bg-surface p-0.5", className)}>
      {opt("de", "Deutsch")}
      {opt("ar", "العربية")}
    </div>
  );
}
