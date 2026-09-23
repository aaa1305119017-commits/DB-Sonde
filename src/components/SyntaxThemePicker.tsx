import { useEffect, useRef, useState } from "react";
import { Palette, Check } from "lucide-react";
import { useApp } from "../store/appStore";
import { useI18n } from "../hooks/useI18n";
import { SYNTAX_THEMES } from "../store/syntaxThemes";

/** 工具栏里的代码配色选择器。
 *  只换 SQL 编辑器的语法着色，不动界面明暗——那是旁边的日/月按钮管的。 */
export default function SyntaxThemePicker() {
  const { t, language } = useI18n();
  const current = useApp((s) => s.syntaxTheme);
  const setSyntaxTheme = useApp((s) => s.setSyntaxTheme);
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // 点外面或按 Esc 关掉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!hostRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="syntax-picker" ref={hostRef}>
      <button
        className="icon-btn"
        title={t("toolbar.syntaxTheme")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Palette size={17} />
      </button>
      {open && (
        <div className="syntax-menu" role="listbox" aria-label={t("toolbar.syntaxTheme")}>
          <div className="syntax-menu-title">{t("toolbar.syntaxTheme")}</div>
          {SYNTAX_THEMES.map((theme) => (
            <button
              key={theme.id}
              role="option"
              aria-selected={theme.id === current}
              className={"syntax-item" + (theme.id === current ? " is-active" : "")}
              onClick={() => {
                setSyntaxTheme(theme.id);
                setOpen(false);
              }}
            >
              <span className="syntax-swatch" aria-hidden="true">
                {theme.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span className="syntax-text">
                <span className="syntax-name">
                  {language === "zh-CN" ? theme.zh : theme.name}
                </span>
                <span className="syntax-hint">{theme.hint}</span>
              </span>
              {theme.id === current && <Check size={14} className="syntax-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
