import type { TranslationKey } from "../../i18n";
import { type DashboardWidgetType } from "./domain";

type Translate = (key: TranslationKey, variables?: Record<string, string | number>) => string;

/** 组件类型 → 默认标题(i18n)。 */
export function widgetTitle(type: DashboardWidgetType, t: Translate): string {
  const key = `dashboard.widget.${type}` as TranslationKey;
  return t(key);
}
