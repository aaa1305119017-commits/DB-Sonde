export const connKey = (connId: string) => `c:${connId}`;
export const catalogKey = (connId: string, database?: string) => `${connId}\u0000${database ?? ""}`;
export const dbKey = (connId: string, db: string) => `c:${connId}/d:${db}`;
export const schemaKey = (connId: string, db: string, s: string) => `${dbKey(connId, db)}/s:${s}`;
