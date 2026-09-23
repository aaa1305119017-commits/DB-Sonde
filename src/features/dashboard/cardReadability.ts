import type { CSSProperties } from "react";
import type { DashboardAppearanceOptions } from "./domain";
import { maxOf, minOf } from "../../lib/numbers";

export function rgb(value?: string): number[] | undefined {
  if (!value) return;
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (h) { const hex = h[1].length === 3 ? [...h[1]].map(c => c+c).join("") : h[1]; return [0,2,4].map(i => parseInt(hex.slice(i,i+2),16)); }
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value.trim());
  if (srgb) return srgb.slice(1).map(v => Number(v)*255);
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (m) { const parts=m[1].split(/[, /]+/).map(Number); if (parts.length===3 || parts[3]===1) return parts.slice(0,3); }
}
export function contrast(a: number[], b: number[]): number {
  const lum = (v: number[]) => v.map(n => { const c=n/255; return c<=.04045?c/12.92:((c+.055)/1.055)**2.4; }).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
  const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function readableColor(color: string | undefined, background: string | undefined): string | undefined {
  const bg=rgb(background), fg=rgb(color);
  if (!bg || !fg || contrast(fg,bg)>=4.5) return color;
  const target = contrast([20,27,38],bg)>contrast([245,248,252],bg) ? [20,27,38] : [245,248,252];
  // Neutral text should use the card foreground; preserve hues only for accents.
  if (maxOf(fg)!-minOf(fg)!<32) return target[0]===20 ? "#141b26" : "#f5f8fc";
  for (let step=1; step<=20; step++) {
    const adjusted=fg.map((v,i)=>Math.round(v+(target[i]-v)*step/20));
    if (contrast(adjusted,bg)>=4.5) return `#${adjusted.map(v=>v.toString(16).padStart(2,"0")).join("")}`;
  }
  return `rgb(${target.join(",")})`;
}
/** Explicit solid backgrounds need their own foreground tokens, even inside a dark preset. */
export function cardReadability(ap: DashboardAppearanceOptions): CSSProperties {
  const effective = appearanceBackground(ap);
  const bg=rgb(effective); if(!bg) return {};
  if (!rgb(ap.background)) return { color: readableColor(ap.textColor, effective) } as CSSProperties;
  const fg=contrast([20,27,38],bg)>contrast([245,248,252],bg)?"#141b26":"#f5f8fc";
  return { "--text":fg, "--text-2":fg, "--text-3":fg, "--surface":ap.background,
    color:readableColor(ap.textColor,ap.background) ?? fg } as CSSProperties;
}

/** Conservative bright surface samples from the built-in dark gradients. */
const PRESET_SURFACES: Record<string, string> = {
  aurora: "#234f51", ocean: "#244c6e", violet: "#493258", sunset: "#604039",
  glass: "#34404d", gold: "#514629", jade: "#24533c", rose: "#59304c",
  ember: "#603529", cyber: "#403653", slate: "#29384a", mint: "#245346",
  amber: "#51402a", plum: "#503357", coral: "#573533", indigo: "#34395c",
};
export function appearanceBackground(ap: DashboardAppearanceOptions = {}): string | undefined {
  return ap.background || PRESET_SURFACES[ap.visualPreset ?? ""];
}
export function darkPreset(ap: DashboardAppearanceOptions = {}): boolean {
  return !!PRESET_SURFACES[ap.visualPreset ?? ""];
}
