import { useState, type ReactNode } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { useAiStrings } from "./strings";

/** Minimal, dependency-free renderer for AI replies: fenced ```code``` blocks
 *  become boxed, copy-able code; everything else is prose with light inline
 *  formatting. Handles a still-streaming, unclosed fence gracefully. */
type Seg = { type: "code"; lang: string; text: string } | { type: "text"; text: string };

function parse(src: string): Seg[] {
  const segs: Seg[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) segs.push({ type: "text", text: src.slice(last, m.index) });
    segs.push({ type: "code", lang: (m[1] || "sql").toLowerCase(), text: m[2].replace(/\n+$/, "") });
    last = re.lastIndex;
  }
  const tail = src.slice(last);
  const open = tail.indexOf("```");
  if (open >= 0) {
    // An opening fence that hasn't closed yet (mid-stream): render as code.
    if (open > 0) segs.push({ type: "text", text: tail.slice(0, open) });
    const rest = tail.slice(open + 3);
    const nl = rest.indexOf("\n");
    const lang = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
    segs.push({ type: "code", lang: (lang || "sql").toLowerCase(), text: nl >= 0 ? rest.slice(nl + 1) : "" });
  } else if (tail) {
    segs.push({ type: "text", text: tail });
  }
  return segs;
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) nodes.push(<code key={k++} className="ai-icode">{m[1]}</code>);
    else nodes.push(<strong key={k++}>{m[2]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function CopyBtn({
  text,
  label,
  className = "ai-chip",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const t = useAiStrings();
  const [done, setDone] = useState(false);
  const copy = () =>
    navigator.clipboard
      ?.writeText(text)
      ?.then(() => {
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      })
      .catch(() => {});
  return (
    <button className={className} onClick={copy}>
      {done ? <Check size={13} /> : <ClipboardCopy size={13} />} {done ? t("copied") : label}
    </button>
  );
}

export default function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="ai-prose">
      {parse(content).map((s, i) =>
        s.type === "code" ? (
          <div className="ai-code" key={i}>
            <div className="ai-code-head">
              <span className="ai-code-lang">{s.lang}</span>
              <CopyBtn text={s.text} className="ai-code-copy" />
            </div>
            <pre>{s.text}</pre>
          </div>
        ) : s.text.trim() ? (
          <p className="ai-para" key={i}>
            {inline(s.text.trim())}
          </p>
        ) : null,
      )}
    </div>
  );
}
