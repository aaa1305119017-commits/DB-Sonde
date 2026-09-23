import { create } from "zustand";
import type { AppState } from "./appTypes";
export type * from "./appTypes";
export const DEFAULT_MAX_ROWS = 10000;
export { catalogKey } from "./stateKeys";
import { createConnectionsSlice } from "./connectionsSlice";
import { createTreeSlice } from "./treeSlice";
import { createQuerySlice } from "./querySlice";
import { createWorkspaceSlice } from "./workspaceSlice";
import { createShellSlice } from "./shellSlice";
/** Composition root only. Feature state and actions belong to their own slices. */
export const useApp = create<AppState>((...args) => ({
    ...createConnectionsSlice(...args),
    ...createTreeSlice(...args),
    ...createQuerySlice(...args),
    ...createWorkspaceSlice(...args),
    ...createShellSlice(...args),
}));
