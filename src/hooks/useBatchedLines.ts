import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 流式输出的行缓冲 —— 攒一批再刷,而不是每来一行就重绘一次。
 *
 * Python 脚本和 pip 都是一行一行往上报的。原来两处都写成
 * `setOut(o => [...o, line])`:每行都把整个数组复制一遍,还触发一次渲染。
 * 打印五万行就是五万次全量复制(二次复杂度)加五万次渲染,界面直接卡死。
 *
 * **这不是截断**:一行都不少,只是不再逐行重绘。数据全在,只是每 50 毫秒
 * 才合并刷一次 —— 人眼也看不出 50 毫秒的差别。
 *
 * 收尾那类要立刻显示的(「完成」「退出码 N」「失败了」),调用方自己 flush 一下。
 */
export function useBatchedLines<T>(): {
  lines: T[];
  /** 追加一行,攒着,稍后一起刷。 */
  push: (line: T) => void;
  /** 立刻把攒着的刷出去 —— 收尾那条别等。 */
  flush: () => void;
  /** 整段换掉(开跑 / 清空),连没刷出去的那批一起丢。 */
  reset: (lines: T[]) => void;
} {
  const [lines, setLines] = useState<T[]>([]);
  const pending = useRef<T[]>([]);
  const timer = useRef<number | null>(null);

  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const flush = useCallback(() => {
    cancel();
    const batch = pending.current;
    if (!batch.length) return;
    pending.current = [];
    setLines((current) => current.concat(batch));
  }, []);

  const push = useCallback(
    (line: T) => {
      pending.current.push(line);
      if (timer.current !== null) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        flush();
      }, 50);
    },
    [flush],
  );

  const reset = useCallback((next: T[]) => {
    cancel();
    pending.current = [];
    setLines(next);
  }, []);

  // 组件卸载时别留着定时器,否则它会往已经没了的组件里 setState
  useEffect(() => cancel, []);

  return { lines, push, flush, reset };
}
