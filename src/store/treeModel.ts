import { translate, type Language } from "../i18n";
import type { ColumnInfo, ConnectionConfig, RoutineInfo, TableInfo } from "../types";
import type { TreeNode } from "./appTypes";
import { connKey } from "./stateKeys";
export function connectionNode(cfg: ConnectionConfig): TreeNode {
    return {
        key: connKey(cfg.id),
        kind: "connection",
        label: cfg.name,
        connId: cfg.id,
        childKeys: [],
        hasChildren: true,
        loaded: false,
        loading: false,
        expanded: false,
    };
}
export function buildNamespaceChildren(parentKey: string, connId: string, database: string, schema: string, tables: TableInfo[], routines: RoutineInfo[], language: Language): {
    nodes: Record<string, TreeNode>;
    childKeys: string[];
} {
    const nodes: Record<string, TreeNode> = {};
    const tableKeys: string[] = [];
    const viewKeys: string[] = [];
    const procedureKeys: string[] = [];
    const functionKeys: string[] = [];
    for (const t of tables) {
        const isView = t.kind === "view";
        const key = `${parentKey}/t:${t.name}`;
        nodes[key] = {
            key,
            kind: isView ? "view" : "table",
            label: t.name,
            connId,
            database,
            schema,
            table: t.name,
            objectInfo: t,
            childKeys: [],
            hasChildren: true,
            loaded: false,
            loading: false,
            expanded: false,
        };
        (isView ? viewKeys : tableKeys).push(key);
    }
    for (const routine of routines) {
        const key = `${parentKey}/r:${routine.kind}:${routine.name}`;
        nodes[key] = {
            key,
            kind: routine.kind,
            label: routine.name,
            connId,
            database,
            schema,
            routineInfo: routine,
            detail: routine.returnType ?? routine.language ?? undefined,
            childKeys: [],
            hasChildren: false,
            loaded: true,
            loading: false,
            expanded: false,
        };
        (routine.kind === "procedure" ? procedureKeys : functionKeys).push(key);
    }
    const childKeys: string[] = [];
    const makeFolder = (kind: "tables" | "views" | "procedures" | "functions", keys: string[]) => {
        const key = `${parentKey}/f:${kind}`;
        nodes[key] = {
            key,
            kind: "folder",
            label: `${translate(language, `folder.${kind}`)} (${keys.length})`,
            connId,
            database,
            schema,
            folderType: kind,
            childKeys: keys,
            hasChildren: keys.length > 0,
            loaded: true,
            loading: false,
            expanded: kind === "tables" && keys.length > 0 && keys.length <= 40,
        };
        childKeys.push(key);
    };
    makeFolder("tables", tableKeys);
    makeFolder("views", viewKeys);
    makeFolder("procedures", procedureKeys);
    makeFolder("functions", functionKeys);
    return { nodes, childKeys };
}
export function columnNodes(tableKey: string, connId: string, database: string, schema: string, table: string, cols: ColumnInfo[], language: Language): {
    nodes: Record<string, TreeNode>;
    childKeys: string[];
} {
    const nodes: Record<string, TreeNode> = {};
    const childKeys: string[] = [];
    for (const c of cols) {
        const key = `${tableKey}/col:${c.name}`;
        nodes[key] = {
            key,
            kind: "column",
            label: c.name,
            connId,
            database,
            schema,
            table,
            detail: c.dataType + (c.nullable ? "" : ` · ${translate(language, "tree.notNull")}`),
            isPk: c.isPrimaryKey,
            childKeys: [],
            hasChildren: false,
            loaded: true,
            loading: false,
            expanded: false,
        };
        childKeys.push(key);
    }
    return { nodes, childKeys };
}
