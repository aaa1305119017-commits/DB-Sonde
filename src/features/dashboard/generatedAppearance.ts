import type { DashboardDocument, DashboardWidget } from "./domain";
import { darkPreset, rgb } from "./cardReadability";
import { maxOf, minOf } from "../../lib/numbers";

type Style = Pick<DashboardWidget["options"], "appearance" | "text" | "table" | "kpi">;
function paleNeutral(value?: string): boolean {
  const c = rgb(value);
  return !!c && minOf(c)! > 220 && maxOf(c)! - minOf(c)! < 24;
}
/** Repair contradictory neutral surfaces, retaining colored accents and explicit light designs. */
export function repairGeneratedStyle<T extends Style>(style: T): T {
  const ap = style.appearance ?? {};
  if (!darkPreset(ap)) return style;
  return { ...style,
    appearance: { ...ap,
      ...(paleNeutral(ap.background) ? { background: undefined } : {}),
      ...(paleNeutral(ap.borderColor) ? { borderColor: undefined } : {}),
    },
    ...(style.table && paleNeutral(style.table.headerBg) ? {
      table: { ...style.table, headerBg: undefined, headerText: undefined },
    } : {}),
  };
}

/** One-time upgrade: later manual edits remain authoritative and stored data is untouched until save. */
export function repairGeneratedDashboard(doc: DashboardDocument): DashboardDocument {
  if (!doc.aiProvenance || (doc.aiProvenance.appearanceVersion ?? 0) >= 1) return doc;
  let widgets = doc.widgets.map(w => ({ ...w, options: repairGeneratedStyle(w.options) }));
  // Remove only clearly unused rows in full-width short notes; never move across spanning cards.
  for (const source of [...widgets].sort((a,b)=>a.y-b.y)) {
    const w = widgets.find(item=>item.id===source.id)!;
    if (w.type !== "text" || w.parentId || w.w !== 12 || w.x !== 0 || w.h <= 2 || w.filtersEnabled) continue;
    const text=w.options.content ?? "";
    const font=w.options.text?.fontSize ?? 20;
    const estimatedLines=text.split("\n").reduce((n,line)=>n+Math.max(1,Math.ceil([...line].length/75)),0);
    if (estimatedLines*font*(w.options.text?.lineHeight ?? 150)/100 > 72) continue;
    const end=w.y+w.h, removed=w.h-2;
    if (widgets.some(other=>!other.parentId && other.id!==w.id && other.y<end && other.y+other.h>w.y)) continue;
    widgets=widgets.map(other=>other.id===w.id ? {...other,h:2} : !other.parentId && other.y>=end ? {...other,y:other.y-removed} : other);
  }
  return { ...doc, widgets, aiProvenance: { ...doc.aiProvenance, appearanceVersion: 1 } };
}
