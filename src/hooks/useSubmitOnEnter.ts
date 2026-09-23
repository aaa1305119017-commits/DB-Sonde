import { useRef, type KeyboardEvent } from "react";

/** Shared AI composer keys, including WebKit's IME confirmation fallback. */
export function useSubmitOnEnter(submit: () => void) {
  const composing = useRef(false);
  return {
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; },
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.defaultPrevented) return;
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) submit();
    },
  };
}
