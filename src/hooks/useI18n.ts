import { useCallback } from "react";
import { dayjsLocale, intlLocale, translate, type MessageKey } from "../i18n";
import { useAppStore } from "../store";

export function useI18n() {
  const language = useAppStore((state) => state.language);
  const t = useCallback((key: MessageKey, variables?: Record<string, string | number>) => translate(language, key, variables), [language]);
  return { language, t, dayjsLocale: dayjsLocale[language], intlLocale: intlLocale[language] };
}
