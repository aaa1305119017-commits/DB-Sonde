import { genericAdapter } from "./generic";
import type { EtlAdapter, EtlKind } from "../types";
import { dataxAdapter } from "./datax";
import { kettleAdapter } from "./kettle";
import { sqoopAdapter } from "./sqoop";

/** A reserved adapter slot — shown as "即将支持", can't parse yet. */
function reserved(kind: EtlKind, label: string, blurb: string): EtlAdapter {
  return {
    kind,
    label,
    blurb,
    available: false,
    inputHint: "",
    parse() {
      throw new Error(`${label} 接入即将支持`);
    },
  };
}

/** The registry. New ETL tools slot in here; the center enumerates it. */
export const etlAdapters: Record<EtlKind, EtlAdapter> = {
  datax: dataxAdapter,
  airflow: reserved("airflow", "Airflow", "解析 DAG / operator 依赖"),
  kettle: kettleAdapter,
  sqoop: sqoopAdapter,
  generic: genericAdapter,
};

export const etlAdapterList: EtlAdapter[] = Object.values(etlAdapters);
export const getEtlAdapter = (kind: EtlKind): EtlAdapter => etlAdapters[kind];
