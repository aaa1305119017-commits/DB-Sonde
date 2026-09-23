import { translate } from "../i18n";
import { api } from "../lib/api";
import type { ConnectionConfig } from "../types";
import type { AppSlice } from "./appTypes";
import { connKey } from "./stateKeys";
import { connectionNode } from "./treeModel";
import { applyConnOrder, loadConnOrder } from "./treePreferences";
const sessionPasswords = new Map<string, string>();
type ConnectionsSlice = AppSlice<
  | "connections"
  | "meta"
  | "databases"
  | "autocommit"
  | "connecting"
  | "dialogOpen"
  | "openDialog"
  | "closeDialog"
  | "refreshConnections"
  | "autoConnectSaved"
  | "deleteConnection"
  | "connect"
  | "rememberSessionPassword"
  | "closePasswordPrompt"
  | "disconnect"
  | "setAutocommit"
  | "commitSession"
  | "rollbackSession"
>;

export const createConnectionsSlice: ConnectionsSlice = (set, get) => {
  let autoConnectStarted = false;
  return ({
    connections: [],
    meta: {},
    databases: {},
    autocommit: {},
    connecting: {},
    dialogOpen: false,
    openDialog(editing) {
        set({ dialogOpen: true, dialogEditing: editing });
    },
    closeDialog() {
        set({ dialogOpen: false, dialogEditing: undefined });
    },
    async refreshConnections() {
        const connections = applyConnOrder(await api.listConnections(), loadConnOrder());
        for (const previous of get().connections) {
            const next = connections.find(c => c.id === previous.id);
            if (!next || ["kind", "host", "port", "username", "database", "sslMode"].some(key => previous[key as keyof ConnectionConfig] !== next[key as keyof ConnectionConfig]))
                sessionPasswords.delete(previous.id);
        }
        const nodes = { ...get().nodes };
        const rootKeys: string[] = [];
        for (const c of connections) {
            const key = connKey(c.id);
            rootKeys.push(key);
            if (!nodes[key])
                nodes[key] = connectionNode(c);
            else
                nodes[key] = { ...nodes[key], label: c.name };
        }
        set({ connections, nodes, rootKeys });
        // A tab that outlives its connection is stranded: it cannot connect and it
        // cannot close itself, so it sits on "connect and open" forever — and since
        // the workspace is persisted, restarting brings it right back. Clean up here
        // rather than in deleteConnection so a connection removed any other way is
        // covered too. Same rule treeSlice uses when a database or table is dropped:
        // close the object browsers, keep the SQL the user wrote in query tabs.
        const live = new Set(connections.map(c => c.id));
        for (const tab of get().tabs)
            if ((tab.kind === "table" || tab.kind === "database" || tab.kind === "routine") &&
                tab.connId && !live.has(tab.connId))
                get().closeTab(tab.id, true);
    },
    async autoConnectSaved() {
        // One launch attempt per store, including React StrictMode's repeated initialization.
        if (autoConnectStarted) return;
        autoConnectStarted = true;
        const pending = get().connections.filter(c => c.kind !== "sqlite").map(c => ({ id: c.id, name: c.name }));
        const failures: string[] = [];
        const worker = async () => {
            while (pending.length) {
                const next = pending.shift()!;
                if (!get().connections.some(c => c.id === next.id) || get().meta[next.id] || get().connecting[next.id]) continue;
                try { await get().connect(next.id, null, { automatic: true }); }
                catch { failures.push(next.name); }
            }
        };
        await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
        if (failures.length) get().showToast({ kind: "warn", text: get().language === "zh-CN"
            ? `自动连接未成功：${failures.join("、")}。可手动连接以检查网络或更新密码。`
            : `Could not auto-connect: ${failures.join(", ")}. Connect manually to check the network or update credentials.` });
    },
    async deleteConnection(id) {
        await api.deleteConnection(id);
        sessionPasswords.delete(id);
        const nodes = { ...get().nodes };
        delete nodes[connKey(id)];
        const meta = { ...get().meta };
        delete meta[id];
        const catalogs = { ...get().catalogs };
        for (const key of Object.keys(catalogs)) {
            if (key.startsWith(`${id}\u0000`))
                delete catalogs[key];
        }
        set({ meta, catalogs });
        await get().refreshConnections();
        get().showToast({ kind: "info", text: translate(get().language, "connection.removed") });
    },
    async connect(id, password, options) {
        const automatic = options?.automatic === true;
        const config = get().connections.find((item) => item.id === id);
        if (!config) {
            // The connection was deleted. Returning silently makes the button in the
            // stranded-tab placeholder look dead — nothing happens, no explanation.
            // Auto-connect passes through quietly; it has no user waiting on a click.
            if (!automatic)
                get().showToast({ kind: "error", text: translate(get().language, "connection.missing") });
            return;
        }
        const needsPassword = config.kind !== "sqlite";
        if (get().connecting[id] || automatic && get().meta[id])
            return;
        if (password != null)
            sessionPasswords.set(id, password);
        const sessionPassword = !automatic && needsPassword ? (sessionPasswords.get(id) ?? null) : null;
        set((s) => ({ connecting: { ...s.connecting, [id]: true } }));
        try {
            const meta = await api.connect(id, sessionPassword);
            set((s) => ({
                meta: { ...s.meta, [id]: meta },
                autocommit: { ...s.autocommit, [id]: true },
            }));
            if (get().passwordPromptId === id) set({ passwordPromptId: undefined });
            // Auto-expand the connection root.
            const key = connKey(id);
            const node = get().nodes[key];
            if (node) {
                set((s) => ({
                    nodes: { ...s.nodes, [key]: { ...node, expanded: true } },
                }));
                await get().loadChildren(key);
            }
            void get().loadCatalog(id, meta.currentDatabase);
            if (meta.hasMultipleDatabases) {
                void api
                    .listDatabases(id)
                    .then((dbs) => set((s) => ({ databases: { ...s.databases, [id]: dbs } })))
                    .catch(() => { });
            }
            if (!automatic || meta.credentialWarning) get().showToast({
                kind: meta.credentialWarning ? "warn" : "success",
                text: meta.credentialWarning ?? translate(get().language, "connection.success", {
                    version: meta.serverVersion || meta.kind,
                }),
            });
        }
        catch (e) {
            if (needsPassword)
                sessionPasswords.delete(id);
            // The backend loads the encrypted credential before contacting the database.
            // Missing credentials never become a login prompt during startup.
            if (automatic) {
                if (String(e).includes("CREDENTIAL_REQUIRED")) return;
                throw e;
            }
            if (String(e).includes("CREDENTIAL_REQUIRED") || String(e).includes("CREDENTIAL_REJECTED")) {
                set({ passwordPromptId: id });
                if (String(e).includes("CREDENTIAL_REJECTED"))
                    get().showToast({ kind: "warn", text: "保存的密码已失效，请重新输入" });
                return;
            }
            get().showToast({ kind: "error", text: String(e) });
            throw e;
        }
        finally {
            set((s) => ({ connecting: { ...s.connecting, [id]: false } }));
        }
    },
    rememberSessionPassword(id, password) {
        sessionPasswords.set(id, password);
    },
    closePasswordPrompt() {
        set({ passwordPromptId: undefined });
    },
    async disconnect(id) {
        await api.disconnect(id);
        const meta = { ...get().meta };
        delete meta[id];
        const autocommit = { ...get().autocommit };
        delete autocommit[id];
        const catalogs = { ...get().catalogs };
        for (const catalog of Object.keys(catalogs)) {
            if (catalog.startsWith(`${id}\u0000`))
                delete catalogs[catalog];
        }
        // Reset the connection node so its children reload next time.
        const key = connKey(id);
        const nodes = { ...get().nodes };
        // Drop all descendant nodes.
        for (const k of Object.keys(nodes)) {
            if (k.startsWith(key + "/"))
                delete nodes[k];
        }
        if (nodes[key]) {
            nodes[key] = { ...nodes[key], childKeys: [], loaded: false, expanded: false };
        }
        set({ meta, autocommit, catalogs, nodes });
    },
    async setAutocommit(connId, enabled, database) {
        try {
            await api.setAutocommit(connId, enabled, database);
            set((s) => ({ autocommit: { ...s.autocommit, [connId]: enabled } }));
        } catch (e) {
            get().showToast({ kind: "error", text: String(e) });
        }
    },
    async commitSession(connId) {
        try {
            await api.commitSession(connId);
            get().showToast({ kind: "success", text: translate(get().language, "tx.committed") });
        }
        catch (e) {
            get().showToast({ kind: "error", text: String(e) });
        }
    },
    async rollbackSession(connId) {
        try {
            await api.rollbackSession(connId);
            get().showToast({ kind: "success", text: translate(get().language, "tx.rolledBack") });
        }
        catch (e) {
            get().showToast({ kind: "error", text: String(e) });
        }
    }
});
};
