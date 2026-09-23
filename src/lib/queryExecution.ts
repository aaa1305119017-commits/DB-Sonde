import type { QueryExecution, QueryResult } from "../types";

export interface QueryExecutionPort {
  execute: (sql: string) => Promise<QueryResult>;
  isCurrent: () => boolean;
  canContinue: () => boolean;
  started: (index: number) => void;
  settled: (index: number, executions: QueryExecution[]) => void;
}

/** Serial SQL execution; driver access and ownership are supplied by the caller. */
export async function executeQueryScript(statements: readonly string[], port: QueryExecutionPort): Promise<void> {
  const executions: QueryExecution[] = statements.map(sql => ({ sql }));
  for (let index = 0; index < statements.length; index++) {
    if (!port.isCurrent() || !port.canContinue()) return;
    port.started(index);
    try {
      const result = await port.execute(statements[index]);
      executions[index] = { sql: statements[index], result };
    } catch (error) {
      executions[index] = { sql: statements[index], error: String(error) };
    }
    // A late response belongs only to the run that issued it, never a replacement tab/run.
    if (!port.isCurrent()) return;
    port.settled(index, [...executions]);
    if (executions[index].error) return;
  }
}
