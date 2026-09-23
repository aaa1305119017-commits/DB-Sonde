import { useCallback, useRef, useState } from "react";

/**
 * Pointer-drag helper for resizers. `onDelta` receives the movement since the
 * drag started along the chosen axis.
 */
export function useDrag(onDelta: (deltaPx: number) => void, axis: "x" | "y") {
  const [active, setActive] = useState(false);
  const start = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      start.current = axis === "x" ? e.clientX : e.clientY;
      setActive(true);

      const move = (ev: PointerEvent) => {
        const now = axis === "x" ? ev.clientX : ev.clientY;
        onDelta(now - start.current);
        start.current = now;
      };
      const up = () => {
        setActive(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onDelta, axis],
  );

  return { active, onPointerDown };
}
