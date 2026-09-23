import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardDocument } from "./domain";

const MAX_HISTORY = 60;

/** Local draft history for editor actions. Persistence and published versions
 * remain separate concerns owned by the dashboard repository. */
export function useDashboardHistory(
  document: DashboardDocument | undefined,
  setDocument: Dispatch<SetStateAction<DashboardDocument | undefined>>,
  markDirty: () => void,
) {
  const documentRef = useRef<DashboardDocument | undefined>(undefined);
  const stackRef = useRef<DashboardDocument[]>([]);
  const [historySize, setHistorySize] = useState(0);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  const remember = useCallback((current: DashboardDocument) => {
    stackRef.current.push(structuredClone(current));
    if (stackRef.current.length > MAX_HISTORY) stackRef.current.shift();
    setHistorySize(stackRef.current.length);
  }, []);

  const clearHistory = useCallback(() => {
    stackRef.current = [];
    setHistorySize(0);
  }, []);

  const updateDocument = useCallback((
    update: (current: DashboardDocument) => DashboardDocument,
    record = true,
  ) => {
    const current = documentRef.current;
    if (!current) return;
    // 先算再记:reducer 原样返回 current 表示这次编辑没成(比如没有可筛选的维度),
    // 那就不该留下一步撤销、也不该把看板标成脏的。
    const updated = update(current);
    if (updated === current) return;
    if (record) remember(current);
    const next: DashboardDocument = { ...updated, status: "draft" };
    documentRef.current = next;
    setDocument(next);
    markDirty();
  }, [markDirty, remember, setDocument]);

  const rememberCurrent = useCallback(() => {
    const current = documentRef.current;
    if (current) remember(current);
  }, [remember]);

  const undo = useCallback(() => {
    const previous = stackRef.current.pop();
    if (!previous) return false;
    const next: DashboardDocument = { ...previous, status: "draft" };
    documentRef.current = next;
    setDocument(next);
    setHistorySize(stackRef.current.length);
    markDirty();
    return true;
  }, [markDirty, setDocument]);

  return {
    canUndo: historySize > 0,
    clearHistory,
    rememberCurrent,
    undo,
    updateDocument,
  };
}
