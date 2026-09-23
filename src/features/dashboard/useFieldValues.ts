/**
 * 「这个字段有哪些取值」—— 设计态左栏的锁定数据范围和查看态组件上那排筛选框都问它。
 *
 * 两边本来各写了一套 load():同样的 loading/options 状态机,却连查的东西都不一样 ——
 * 一套查全局数据集,一套查组件编译出来的那句 SQL。长得一样行为不一样,是最难发现的那种
 * 重复。这里收成一处,顺带把「查哪个」这件事说清楚:
 *
 * 有全局数据集就查它(组件没 SELECT 的列也能筛),没有就退回组件那份编译产物
 * —— 导入的 HTML 和 AI 生成的指标看板只有后者。
 */
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../store/appStore";
import { useDatasets } from "../datasets/datasetsStore";
import { datasetDimensionValues, dimensionValues, type DimensionValues } from "./dataService";
import { executeDataset } from "./query";
import type { DashboardDataset } from "./domain";

export interface FieldValues extends DimensionValues {
  loading: boolean;
}

const EMPTY: FieldValues = { values: [], truncated: false, loading: false };
const PENDING: FieldValues = { values: [], truncated: false, loading: true };

export function useFieldValues(
  datasetId: string | undefined,
  /** 组件编译好的数据集,没有全局数据集时的退路。 */
  compiled: DashboardDataset | undefined,
  translateError: Parameters<typeof executeDataset>[1],
) {
  const dataset = useDatasets((s) => s.datasets.find((item) => item.id === datasetId));
  const connections = useApp((s) => s.connections);
  const [map, setMap] = useState<Record<string, FieldValues>>({});

  /* 数据集是全局的,可这个列表只在数据集面板打开过才读过 —— 看板先开的话读到的是空的。 */
  useEffect(() => { void useDatasets.getState().ensureLoaded(); }, []);
  /* 换数据集就把候选值扔掉:上一个数据集的网点清单套在这个数据集上是错的。
     光清空不够 —— 在途的那次查询回来照样会写进新数据集的表里,而且因为它比用户
     点开的晚,看到的就是上一个数据集的取值。记下当前是谁,回来对不上就丢掉。 */
  const current = useRef(datasetId);
  useEffect(() => { current.current = datasetId; setMap({}); }, [datasetId]);

  const valuesOf = (field: string) => map[field] ?? EMPTY;

  const load = async (field: string) => {
    if (map[field]) return; // 已经有了或正在查
    if (!dataset && !compiled) return;
    const asked = datasetId;
    setMap((state) => ({ ...state, [field]: PENDING }));
    try {
      const got = dataset
        ? await datasetDimensionValues(dataset, field, connections.find((c) => c.id === dataset.connectionId)?.kind, translateError)
        : await dimensionValues(compiled!, field, translateError);
      if (current.current !== asked) return;
      setMap((state) => ({ ...state, [field]: { ...got, loading: false } }));
    } catch {
      if (current.current !== asked) return;
      /* 查失败就把这一格删掉,下次点开重试 —— 留个空清单在那儿,
         用户会以为「这个字段真的没值」。 */
      setMap((state) => {
        const next = { ...state };
        delete next[field];
        return next;
      });
    }
  };

  return { valuesOf, load };
}
