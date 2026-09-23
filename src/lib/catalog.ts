import { api } from "./api";
import type { CompletionCatalog, ConnectionMeta } from "../types";

interface Namespace {
  [name: string]: Namespace | string[];
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function tablesWithColumns(
  connId: string,
  database: string,
  schema: string,
): Promise<Namespace> {
  const tables = await api.listTables(connId, database, schema);
  const entries = await mapWithConcurrency(tables, 8, async (table) => {
    const columns = await api.listColumns(connId, database, schema, table.name);
    return [table.name, columns.map((column) => column.name)] as const;
  });
  return Object.fromEntries(entries);
}

/** Build the metadata snapshot consumed by CodeMirror's SQL completion source. */
export async function buildCompletionCatalog(
  connId: string,
  meta: ConnectionMeta,
  databaseOverride?: string,
): Promise<CompletionCatalog> {
  if (meta.kind === "sqlite") {
    return {
      schema: await tablesWithColumns(connId, "main", "main"),
      loadedAt: Date.now(),
    };
  }

  if (meta.kind === "postgres") {
    const database = databaseOverride || meta.currentDatabase;
    const schemas = await api.listSchemas(connId, database);
    const entries = await mapWithConcurrency(schemas, 3, async (schema) => [
      schema,
      await tablesWithColumns(connId, database, schema),
    ] as const);
    return {
      schema: Object.fromEntries(entries),
      defaultSchema: schemas.includes("public") ? "public" : schemas[0],
      loadedAt: Date.now(),
    };
  }

  // Loading every MySQL database can be extremely expensive. Complete the
  // active database eagerly; other databases remain available through the tree.
  const database =
    databaseOverride || meta.currentDatabase || (await api.listDatabases(connId))[0] || "";
  const tables = database ? await tablesWithColumns(connId, database, "") : {};
  return {
    schema: database ? { [database]: tables, ...tables } : tables,
    defaultSchema: database || undefined,
    loadedAt: Date.now(),
  };
}
