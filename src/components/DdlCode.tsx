import { useMemo, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { Copy } from "lucide-react";
import { editorTheme, highlight } from "./SqlEditor";
import { formatDdl } from "../lib/formatDdl";
import { useI18n } from "../hooks/useI18n";
import { useApp } from "../store/appStore";
import type { DbKind } from "../types";

/* DDL 的只读展示:格式化 + 语法高亮,和 SQL 编辑器同一套配色。
 *
 * 单独成一个懒加载组件,因为 CodeMirror 和 sql-formatter 加起来不小,
 * 而表检查器是直接打进主界面的 —— 没必要让每次启动都下载它们,
 * 只有真点开 DDL 标签时才要。 */
export default function DdlCode({ ddl, kind }: { ddl: string; kind?: DbKind }) {
  const { t } = useI18n();
  const pretty = useMemo(() => formatDdl(ddl, kind), [ddl, kind]);
  const [raw, setRaw] = useState(false);
  const shown = raw || !pretty.formatted ? ddl : pretty.text;

  const copy = () => {
    // 复制当前看到的那份 —— 看的是格式化版就复制格式化版
    navigator.clipboard?.writeText(shown);
    useApp.getState().showToast({ kind: "success", text: t("inspector.ddlCopied") });
  };

  const extensions = useMemo(() => [
    sqlLang(),
    syntaxHighlighting(highlight),
    // 原文往往是一整行,不折行就得横向滚几屏
    EditorView.lineWrapping,
    EditorView.editable.of(false),
  ], []);

  if (!ddl.trim()) return <div className="ddl-view"><pre>{t("inspector.noDdl")}</pre></div>;

  return (
    <div className="ddl-view ddl-code">
      <div className="ddl-toolbar">
        {pretty.formatted ? (
          <div className="ddl-toggle" role="group">
            <button className={!raw ? "on" : ""} onClick={() => setRaw(false)}>{t("inspector.ddlPretty")}</button>
            <button className={raw ? "on" : ""} onClick={() => setRaw(true)}>{t("inspector.ddlRaw")}</button>
          </div>
        ) : (
          <span className="ddl-note">{t("inspector.ddlNotFormatted")}</span>
        )}
        <button className="btn ghost sm" onClick={copy}>
          <Copy size={13} /> {t("inspector.copyDdl")}
        </button>
      </div>
      <CodeMirror
        value={shown}
        theme={editorTheme}
        extensions={extensions}
        readOnly
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false }}
      />
    </div>
  );
}
