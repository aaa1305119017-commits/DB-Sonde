import { appearanceBackground, readableColor } from "../cardReadability";
import type { CSSProperties } from "react";
import { useI18n } from "../../../hooks/useI18n";
import type { DashboardWidget } from "../domain";

/** 纯文本组件:标题/说明/富文本占位。不取数,不依赖运行时。 */
export default function TextWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useI18n();
  const tx = widget.options.text ?? {};
  const family = tx.fontFamily === "serif"
    ? "Georgia, 'Songti SC', serif"
    : tx.fontFamily === "mono"
      ? "var(--mono, ui-monospace, monospace)"
      : "inherit";
  const justify = tx.verticalAlign === "top" ? "flex-start" : tx.verticalAlign === "bottom" ? "flex-end" : "center";
  const style: CSSProperties = {
    fontFamily: family,
    fontSize: tx.fontSize ?? 20,
    fontWeight: tx.fontWeight ?? 500,
    lineHeight: `${tx.lineHeight ?? 150}%`,
    textAlign: tx.align ?? "left",
    color: readableColor(tx.color, appearanceBackground(widget.options.appearance)) || undefined,
    display: "flex",
    flexDirection: "column",
    justifyContent: justify,
    height: "100%",
  };
  return (
    <div className="dash-text-content" style={style}>
      {widget.options.content || t("dashboard.textDefault")}
    </div>
  );
}
