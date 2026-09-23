import type { QueryResult } from "../../types";
import type { DatasetShape } from "./validation/dataChecks";

/** Observations available to analysis; no SQL, store, connection or dashboard mutation access. */
export interface ObservedPlan {
  metricIds: string[];
  shape: DatasetShape;
  result?: QueryResult;
  totalResult?: QueryResult;
}
export type PlanReader = (id: string) => ObservedPlan | undefined;
export type DimensionLabel = (key: string) => string;
