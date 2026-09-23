import { useCallback } from "react";
import { translate, type TranslationKey } from "../i18n";
import { useApp } from "../store/appStore";

export function useI18n() {
  const language = useApp((state) => state.language);
  const t = useCallback(
    (key: TranslationKey, variables?: Record<string, string | number>) =>
      translate(language, key, variables),
    [language],
  );
  return { language, t };
}
