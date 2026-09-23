/**
 * 浮层定位。下拉菜单是 position:fixed 挂在 body 上的,得自己算放不放得下。
 *
 * 只写 top = 触发器底边 + 间距的话,触发器在窗口下半截时菜单直接垂到窗口外面 ——
 * 列表是能滚,可滚到的部分在屏幕以下,看上去就是「后面几项没了」。下面放不下就翻到
 * 上面去,高度按实际空隙收。
 *
 * 抽出来是因为这套算法有两个地方要用(多选、单选)。抄一份的话,下次改了一处就分家。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface PopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function usePopover(open: boolean, minWidth = 220, maxHeight = 360) {
  const [position, setPosition] = useState<PopoverPosition>({ top: 0, left: 0, width: minWidth, maxHeight });
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  /* 必须是 useLayoutEffect:useEffect 在浏览器画完之后才跑,于是菜单先以初始值
     (左上角)画一帧,再跳到该在的位置 —— 点开下拉看到的「卡一下,然后才出来」就是这一跳。 */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(minWidth, rect.width);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const gap = 5;
      const margin = 8;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      // 上面明显更宽敞才翻,否则宁可留在下面 —— 菜单老在触发器上下跳更难用。
      const flip = below < 180 && above > below;
      const room = Math.max(120, Math.min(maxHeight, flip ? above : below));
      setPosition({ top: flip ? Math.max(margin, rect.top - gap - room) : rect.bottom + gap, left, width, maxHeight: room });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, minWidth, maxHeight]);

  return { position, anchorRef, popoverRef };
}

/** 点到浮层和触发器之外就关掉。 */
export function useDismiss(
  open: boolean,
  refs: Array<{ current: HTMLElement | null }>,
  onDismiss: () => void,
) {
  /* onDismiss 和 refs 都放进 ref 里每次渲染更新,监听器读 ref ——
     这样依赖真的就只有 open,不用再压一条 eslint-disable(而且这个项目里
     根本没跑 eslint,那条注释只是看着像有人管着)。
     直接把它们写进依赖数组不行:refs 是调用方每次渲染现拼的数组字面量,
     进了依赖就变成每次渲染都重新订阅一遍 document。
     而漏掉它们也不行:今天两个调用方传的都是 `() => setOpen(false)`,
     setOpen 是稳定的所以没事;下一个传 `() => save(draft)` 的人会静默拿到
     第一次渲染时的 draft —— 点外面保存,存下去的是旧值,还查不出为什么。 */
  const latest = useRef({ refs, onDismiss });
  latest.current = { refs, onDismiss };
  useEffect(() => {
    if (!open) return;
    const outside = (target: Node) => !latest.current.refs.some((ref) => ref.current?.contains(target));
    const close = (event: MouseEvent) => { if (outside(event.target as Node)) latest.current.onDismiss(); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") latest.current.onDismiss(); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
}
