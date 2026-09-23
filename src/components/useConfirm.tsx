import { useCallback, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "../hooks/useI18n";

/**
 * 应用内的确认框。
 *
 * webview 里的原生 window.confirm 不可靠(Tauri 下会被吞掉或阻塞渲染),
 * 所以自己画一个,并用 Promise 包起来,调用处就能写成
 * `if (!(await askConfirm(...))) return;` —— 跟原生 confirm 一样顺。
 *
 * 本来只长在 TableInspector 里。进程列表的「杀死会话」也要确认,再抄一份
 * 就是两个弹窗各自演化,所以抽出来。
 */
export function useConfirm(): {
  askConfirm: (text: string, title: string, okLabel?: string) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const { t } = useI18n();
  const [state, setState] = useState<{ text: string; title: string; okLabel?: string } | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const askConfirm = useCallback(
    (text: string, title: string, okLabel?: string) =>
      new Promise<boolean>((resolve) => {
        /* 上一个还没回答就又问一个:把前一个当成"取消"答掉,别让它的 Promise
           永远悬着 —— 调用方多半在 await 它,悬住就是个卡死的按钮。 */
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        setState({ text, title, okLabel });
      }),
    [],
  );

  const answer = (ok: boolean) => {
    setState(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  };

  const confirmDialog =
    state === null ? null : (
      <div className="modal-backdrop" onMouseDown={() => answer(false)}>
        <div className="modal confirm-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>
              <AlertTriangle size={16} /> {state.title}
            </h3>
          </div>
          <div className="modal-body">
            <pre className="confirm-text">{state.text}</pre>
          </div>
          <div className="modal-foot">
            {/* 取消拿 autoFocus:危险操作的默认落点是"不做" */}
            <button className="btn" autoFocus onClick={() => answer(false)}>
              {t("action.cancel")}
            </button>
            <button className="btn danger" onClick={() => answer(true)}>
              {state.okLabel ?? t("data.confirmColumnUpdateOk")}
            </button>
          </div>
        </div>
      </div>
    );

  return { askConfirm, confirmDialog };
}
