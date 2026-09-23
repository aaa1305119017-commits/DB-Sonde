import {
  Play,
  Sparkles,
  ChevronRight,
  SearchCheck,
  Gauge,
  AlignLeft,
  MessageCircleQuestion,
  FileCode2,
  CornerDownLeft,
} from "lucide-react";
import type { EditorAiContext } from "../../components/SqlEditor";
import { useAiStrings } from "./strings";
import type { InlineAction } from "./prompt";

interface Props {
  ctx: EditorAiContext;
  /** Run the current selection (or whole statement) in the editor's own tab. */
  onRunSelection: () => void;
  /** Open the AI dialog for a specific action, or "ask" for the free-ask box. */
  onAiAction: (action: InlineAction | "ask") => void;
  onClose: () => void;
}

/** The SQL editor's right-click menu: Run-selected plus an AI submenu that
 *  reveals the inline actions on hover. Picking an AI item opens the existing
 *  AI dialog (AiInline) unchanged. */
export default function EditorContextMenu({ ctx, onRunSelection, onAiAction, onClose }: Props) {
  const t = useAiStrings();
  const hasSelection = !!ctx.selection.trim();
  const x = Math.min(ctx.x, window.innerWidth - 230);
  const y = Math.min(ctx.y, window.innerHeight - 130);

  const aiActions: { id: InlineAction; label: string; icon: typeof SearchCheck }[] = [
    { id: "review", label: t("inlineReview"), icon: SearchCheck },
    { id: "optimize", label: t("inlineOptimize"), icon: Gauge },
    { id: "format", label: t("inlineFormat"), icon: AlignLeft },
    { id: "explain", label: t("inlineExplain"), icon: MessageCircleQuestion },
    { id: "fromComment", label: t("inlineFromComment"), icon: FileCode2 },
  ];

  const pick = (action: InlineAction | "ask") => {
    onAiAction(action);
    onClose();
  };

  return (
    <>
      <div
        className="editor-ctx-backdrop"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="editor-ctx" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="ectx-item"
          disabled={!hasSelection}
          onClick={() => {
            onRunSelection();
            onClose();
          }}
        >
          <Play size={14} /> {t("runSelection")}
        </button>

        <div className="ectx-sep" />

        <div className="ectx-item has-sub">
          <Sparkles size={14} style={{ color: "var(--accent)" }} /> AI
          <ChevronRight size={14} className="ectx-caret" />
          <div className="ectx-submenu">
            {aiActions.map((a) => (
              <button key={a.id} className="ectx-item" onClick={() => pick(a.id)}>
                <a.icon size={14} /> {a.label}
              </button>
            ))}
            <div className="ectx-sep" />
            <button className="ectx-item" onClick={() => pick("ask")}>
              <CornerDownLeft size={14} /> {t("askAi")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
