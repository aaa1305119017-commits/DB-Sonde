import { create } from "zustand";

/** A data entity the 360° panel focuses on. For now: a table/view. The panel
 *  gathers everything the other modules know about it (lineage, metrics, ETL). */
export interface EntityTarget {
  connId: string;
  connName?: string;
  database?: string;
  schema?: string;
  table: string;
  objectKind?: "table" | "view";
}

interface EntityState {
  target: EntityTarget | null;
  open: (t: EntityTarget) => void;
  close: () => void;
}

export const useEntity = create<EntityState>((set) => ({
  target: null,
  open: (t) => set({ target: t }),
  close: () => set({ target: null }),
}));

/** Normalized entity id, consistent with the lineage graph node ids. */
export function entityId(database: string | undefined, table: string): string {
  const d = (database ?? "").trim().toLowerCase();
  const t = table.trim().toLowerCase();
  return d && t ? `${d}.${t}` : t;
}
